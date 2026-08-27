"use strict";

const path = require("node:path");
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
    const fs = require("node:fs/promises");
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
