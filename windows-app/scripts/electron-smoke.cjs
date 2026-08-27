"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const packagedBinary = process.env.CALORIE_ELECTRON_BINARY || "";
const electronBinary = packagedBinary || require("electron");
const projectRoot = path.resolve(__dirname, "..");
const debuggingPort = Number(process.env.CALORIE_DEBUGGING_PORT || 49231);
const output = [];

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && target.url === "http://127.0.0.1:47823/",
        );
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // The debug endpoint starts after Electron's browser process is ready.
    }
    await delay(500);
  }
  throw new Error("Electron page did not become available for smoke testing.");
}

function cdpCommand(webSocketUrl, method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Electron CDP evaluation timed out."));
    }, 20_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method,
        params,
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const detail = message.result?.exceptionDetails?.exception?.description ||
          message.result?.exceptionDetails?.text ||
          message.error?.message ||
          "unknown CDP error";
        reject(new Error(`Electron CDP evaluation failed: ${detail}`));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Electron CDP connection failed."));
    });
  });
}

async function evaluate(webSocketUrl, expression) {
  const result = await cdpCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function evaluatePageWithRetry(expression) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const page = await findPage();
    try {
      return {
        page,
        result: await evaluate(page.webSocketDebuggerUrl, expression),
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/execution context|context.*destroyed|target.*(?:closed|navigated)|CDP connection failed/i.test(message)) {
        throw error;
      }
      await delay(500);
    }
  }
  throw lastError || new Error("Electron page did not expose a stable execution context.");
}

async function readReadinessMarker(candidateRoots) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const root of candidateRoots.filter(Boolean)) {
      try {
        return JSON.parse(await fs.readFile(path.join(root, "ui_ready.json"), "utf8"));
      } catch (error) {
        lastError = error;
      }
    }
    await delay(250);
  }
  throw lastError || new Error("The packaged UI readiness marker was not created.");
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    const exitPromise = new Promise((resolve) => child.once("exit", () => resolve(true)));
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 15_000,
    });
    if (result.error) {
      throw new Error(`Electron process-tree termination failed: ${result.error.message}`);
    }
    if (result.status !== 0 && child.exitCode === null) {
      throw new Error(`taskkill rejected Electron process-tree termination with status ${result.status}.`);
    }
    const exited = child.exitCode !== null
      ? true
      : await Promise.race([exitPromise, delay(15_000).then(() => false)]);
    if (!exited && child.exitCode === null) {
      throw new Error("Electron process tree remained alive after taskkill.");
    }
    return;
  } else {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(15_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    throw new Error("Electron process remained alive after SIGTERM.");
  }
}

async function main() {
  const useDefaultProfile = process.env.CALORIE_SMOKE_USE_DEFAULT_PROFILE === "1";
  const temporaryProfile = useDefaultProfile
    ? null
    : await fs.mkdtemp(path.join(os.tmpdir(), "calorie-electron-smoke-"));
  const launchArguments = [
    `--remote-debugging-port=${debuggingPort}`,
    "--disable-gpu",
  ];
  const qaNonce = process.env.CALORIE_QA_NONCE || crypto.randomBytes(16).toString("hex");
  if (!/^[a-f0-9]{32}$/.test(qaNonce)) {
    throw new Error("CALORIE_QA_NONCE must be a 128-bit lowercase hexadecimal value.");
  }
  if (!packagedBinary) launchArguments.unshift(".");
  if (temporaryProfile) launchArguments.push(`--user-data-dir=${temporaryProfile}`);
  const child = spawn(
    electronBinary,
    launchArguments,
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        CALORIE_QA_NONCE: qaNonce,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  try {
    await delay(1_000);
    const evaluation = await evaluatePageWithRetry(
      `(async () => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const bridge = window.calorieStewardDesktop;
          const text = document.body?.innerText || "";
          if (
            bridge?.platform === "windows" &&
            text.length > 100 &&
            /Calorie Steward|卡路里管家/.test(text) &&
            text.includes("LAI ZEYU") &&
            text.includes("来泽宇") &&
            /Settings|privacy|设置|隐私/i.test(text)
          ) {
            const smokeKey = "diet-steward.api-secret.v1.provider-desktop-smoke";
            const smokeValue = "desktop-smoke-placeholder-credential";
            await bridge.secrets.set(smokeKey, smokeValue);
            const credentialReadBack = await bridge.secrets.get(smokeKey);
            await bridge.secrets.delete(smokeKey);
            const credentialAfterDelete = await bridge.secrets.get(smokeKey);
            const canvas = document.createElement("canvas");
            canvas.width = 2;
            canvas.height = 2;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Preview canvas unavailable.");
            context.fillStyle = "#0B766E";
            context.fillRect(0, 0, 2, 2);
            const preview = document.createElement("img");
            preview.src = canvas.toDataURL("image/jpeg", 0.82);
            await preview.decode();
            return {
              platform: bridge.platform,
              version: bridge.version,
              bridgeMethods: [
                typeof bridge.secrets?.get,
                typeof bridge.secrets?.set,
                typeof bridge.secrets?.delete,
                typeof bridge.saveTextFile,
              ],
              crossOriginIsolated,
              rendererHasNodeProcess: Boolean(
                globalThis.process?.versions?.electron || globalThis.process?.type,
              ),
              credentialRoundTrip:
                credentialReadBack === smokeValue && credentialAfterDelete === null,
              inMemoryJpegPreviewLoaded:
                preview.naturalWidth === 2 && preview.naturalHeight === 2,
              text,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("Desktop bridge or UI did not initialize.");
      })()`,
    );
    const { page, result } = evaluation;
    if (result.platform !== "windows" || result.version !== "1.2.3") {
      throw new Error("The Windows preload bridge metadata is invalid.");
    }
    if (result.bridgeMethods.some((type) => type !== "function")) {
      throw new Error("The Windows preload bridge is incomplete.");
    }
    if (!result.crossOriginIsolated) {
      throw new Error("The renderer is not cross-origin isolated for Expo SQLite WASM.");
    }
    if (result.rendererHasNodeProcess) {
      throw new Error("Node.js leaked into the sandboxed renderer.");
    }
    if (!result.credentialRoundTrip) {
      throw new Error("The protected credential bridge round-trip failed.");
    }
    if (!result.inMemoryJpegPreviewLoaded) {
      throw new Error("The in-memory JPEG preview did not decode in Electron.");
    }
    if (/browser preview|浏览器只用于检查首页设计/i.test(result.text)) {
      throw new Error("Electron was incorrectly gated as a browser preview.");
    }
    if (!/Calorie Steward|卡路里管家/.test(result.text)) {
      throw new Error("The packaged UI does not show the product name.");
    }
    if (!result.text.includes("LAI ZEYU") || !result.text.includes("来泽宇")) {
      throw new Error("The packaged UI does not show the exact bilingual author.");
    }
    if (!/Settings|privacy|设置|隐私/i.test(result.text)) {
      throw new Error("The packaged UI does not expose its settings/privacy entry.");
    }
    const markerRoots = temporaryProfile
      ? [temporaryProfile]
      : [
          process.env.CALORIE_EXPECTED_USER_DATA,
          path.join(process.env.APPDATA || "", "Calorie Steward by LAI ZEYU"),
          path.join(process.env.APPDATA || "", "calorie-steward-windows"),
        ];
    const marker = await readReadinessMarker(markerRoots);
    const expectedExecutablePath = path.resolve(electronBinary);
    const expectedExecutableSha256 = await sha256File(expectedExecutablePath);
    if (
      marker.schemaVersion !== 2 ||
      marker.product !== "Calorie Steward by LAI ZEYU" ||
      marker.author !== "LAI ZEYU（来泽宇）" ||
      marker.version !== "1.2.3" ||
      marker.executableSha256 !== expectedExecutableSha256 ||
      path.resolve(marker.executablePath || "").toLowerCase() !==
        expectedExecutablePath.toLowerCase() ||
      marker.processId !== child.pid ||
      marker.origin !== "http://127.0.0.1:47823" ||
      marker.qaNonce !== qaNonce ||
      Number.isNaN(Date.parse(marker.createdAtUtc || "")) ||
      marker.reactRootReady !== true ||
      marker.privacyEntryReady !== true
    ) {
      throw new Error("The packaged UI readiness marker is invalid.");
    }
    if (process.env.CALORIE_SMOKE_SCREENSHOT) {
      await cdpCommand(page.webSocketDebuggerUrl, "Emulation.setDeviceMetricsOverride", {
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: 1366,
        screenHeight: 768,
        positionX: 0,
        positionY: 0,
        dontSetVisibleSize: false,
      });
      await delay(250);
      const screenshot = await cdpCommand(page.webSocketDebuggerUrl, "Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: 1366,
          height: 768,
          scale: 1,
        },
      });
      const screenshotPath = path.resolve(projectRoot, process.env.CALORIE_SMOKE_SCREENSHOT);
      const screenshotBytes = Buffer.from(screenshot.data, "base64");
      const screenshotWidth = screenshotBytes.length >= 24
        ? screenshotBytes.readUInt32BE(16)
        : 0;
      const screenshotHeight = screenshotBytes.length >= 24
        ? screenshotBytes.readUInt32BE(20)
        : 0;
      if (
        screenshotBytes.length < 24 ||
        screenshotBytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        screenshotWidth !== 1366 ||
        screenshotHeight !== 768
      ) {
        throw new Error(
          `Store screenshot must be an exact 1366x768 PNG; received ${screenshotWidth}x${screenshotHeight}.`,
        );
      }
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, screenshotBytes);
    }
    process.stdout.write("Electron desktop bridge, sandbox, isolation, and UI smoke passed.\n");
  } catch (error) {
    const diagnostic = output.join("").slice(-4_000);
    if (diagnostic) process.stderr.write(diagnostic);
    throw error;
  } finally {
    await stopProcess(child);
    if (temporaryProfile) {
      await fs.rm(temporaryProfile, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
