"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require("electron");

const { createSecretStore } = require("./secret-store.cjs");
const { createStaticServer } = require("./static-server.cjs");

const APP_ID = "com.laisystems.caloriesteward.windows";
const LOCAL_PORT = 47823;
const JSON_FILE_NAME = /^[A-Za-z0-9\u3400-\u9fff._ -]{1,96}\.json$/u;
const ALLOWED_EXTERNAL_URLS = [
  "https://github.com/lzy2767865503-pixel/calorie-steward-ai/blob/main/docs/privacy/windows.md",
  "https://github.com/lzy2767865503-pixel/calorie-steward-ai/issues",
];

app.setAppUserModelId(APP_ID);
app.setName("Calorie Steward by LAI ZEYU");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;
let staticServer = null;
let shutdownInProgress = false;

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function recordUiReadiness() {
  const evidence = await mainWindow.webContents.executeJavaScript(`(async () => {
    let lastResult = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const text = document.body?.innerText || "";
      const root = document.getElementById("root");
      const result = {
        title: document.title,
        bodyLength: text.length,
        hasReactRoot: Boolean(root && root.childElementCount > 0),
        hasProduct: /Calorie Steward|卡路里管家/.test(text),
        hasLatinAuthor: text.includes("LAI ZEYU"),
        hasChineseAuthor: text.includes("来泽宇"),
        hasPrivacyEntry: /Settings|privacy|设置|隐私/i.test(text),
      };
      lastResult = result;
      if (
        result.hasReactRoot &&
        result.hasProduct &&
        result.hasLatinAuthor &&
        result.hasChineseAuthor &&
        result.hasPrivacyEntry &&
        result.bodyLength >= 100
      ) return result;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ...lastResult, timedOut: true };
  })()`);
  if (
    !evidence.hasReactRoot ||
    !evidence.hasProduct ||
    !evidence.hasLatinAuthor ||
    !evidence.hasChineseAuthor ||
    !evidence.hasPrivacyEntry ||
    evidence.bodyLength < 100
  ) {
    throw new Error(
      `The packaged React UI did not expose its product, author, and privacy surfaces: ${JSON.stringify(evidence)}`,
    );
  }

  const qaNonce = process.env.CALORIE_QA_NONCE || null;
  if (qaNonce !== null && !/^[a-f0-9]{32}$/.test(qaNonce)) {
    throw new Error("CALORIE_QA_NONCE must be a 128-bit lowercase hexadecimal value.");
  }
  const marker = {
    schemaVersion: 2,
    product: "Calorie Steward by LAI ZEYU",
    author: "LAI ZEYU（来泽宇）",
    version: app.getVersion(),
    executableSha256: await sha256File(process.execPath),
    executablePath: process.execPath,
    processId: process.pid,
    origin: staticServer.origin,
    qaNonce,
    createdAtUtc: new Date().toISOString(),
    title: evidence.title,
    bodyLength: evidence.bodyLength,
    reactRootReady: true,
    privacyEntryReady: true,
  };
  const userData = app.getPath("userData");
  await fs.mkdir(userData, { recursive: true });
  const target = path.join(userData, "ui_ready.json");
  const temporaryTarget = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryTarget, `${JSON.stringify(marker, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rm(target, { force: true });
    await fs.rename(temporaryTarget, target);
  } finally {
    await fs.rm(temporaryTarget, { force: true });
  }
}

function allowExternal(rawUrl) {
  if (!ALLOWED_EXTERNAL_URLS.some((allowed) => rawUrl === allowed)) return false;
  void shell.openExternal(rawUrl, { activate: true });
  return true;
}

function registerIpc() {
  const secrets = createSecretStore({
    safeStorage,
    directory: path.join(app.getPath("userData"), "protected"),
  });
  const assertTrustedSender = (event) => {
    const senderUrl = event.senderFrame?.url || "";
    if (!staticServer || !senderUrl.startsWith(`${staticServer.origin}/`)) {
      throw new Error("The desktop bridge rejected an untrusted sender.");
    }
  };
  ipcMain.handle("credential:get", (event, key) => {
    assertTrustedSender(event);
    return secrets.get(key);
  });
  ipcMain.handle("credential:set", (event, key, value) => {
    assertTrustedSender(event);
    return secrets.set(key, value);
  });
  ipcMain.handle("credential:delete", (event, key) => {
    assertTrustedSender(event);
    return secrets.delete(key);
  });
  ipcMain.handle("export:save-json", async (event, request) => {
    assertTrustedSender(event);
    if (
      !request ||
      typeof request.contents !== "string" ||
      request.contents.length > 50 * 1024 * 1024 ||
      typeof request.defaultFileName !== "string" ||
      !JSON_FILE_NAME.test(request.defaultFileName)
    ) {
      throw new Error("The export request is invalid.");
    }
    JSON.parse(request.contents);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export Calorie Steward records",
      defaultPath: request.defaultFileName,
      filters: [{ name: "JSON records", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, fileName: null };
    }
    await fs.writeFile(result.filePath, request.contents, { encoding: "utf8", flag: "w" });
    return { canceled: false, fileName: path.basename(result.filePath) };
  });
}

async function createWindow() {
  const webRoot = path.join(__dirname, "..", "dist-web");
  staticServer = createStaticServer({ root: webRoot, port: LOCAL_PORT });
  try {
    await staticServer.start();
  } catch (error) {
    dialog.showErrorBox(
      "Calorie Steward could not start",
      `The protected local app port ${LOCAL_PORT} is unavailable. Close the conflicting program and try again.`,
    );
    throw error;
  }

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: "#F3F7FA",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();
  const session = mainWindow.webContents.session;
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === `${staticServer.origin}/` || url.startsWith(`${staticServer.origin}/`)) return;
    event.preventDefault();
    allowExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    allowExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(staticServer.origin);
  await recordUiReadiness();
}

if (hasLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(() => {
      registerIpc();
      return createWindow();
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Calorie Steward startup failed: ${message}`);
      app.quit();
    });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (shutdownInProgress || !staticServer) return;
    event.preventDefault();
    shutdownInProgress = true;
    void staticServer.stop().finally(() => app.quit());
  });
}
