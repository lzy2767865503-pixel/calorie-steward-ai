"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const electronBinary = require("electron");
const projectRoot = path.resolve(__dirname, "..");
const debuggingPort = 49231;
const output = [];

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

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000),
  ]);
}

async function main() {
  const temporaryProfile = await fs.mkdtemp(path.join(os.tmpdir(), "calorie-electron-smoke-"));
  const child = spawn(
    electronBinary,
    [
      ".",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${temporaryProfile}`,
      "--disable-gpu",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "false" },
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
          if (bridge?.platform === "windows" && text.length > 100) {
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
    if (process.env.CALORIE_SMOKE_SCREENSHOT) {
      const screenshot = await cdpCommand(page.webSocketDebuggerUrl, "Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      const screenshotPath = path.resolve(projectRoot, process.env.CALORIE_SMOKE_SCREENSHOT);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    }
    process.stdout.write("Electron desktop bridge, sandbox, isolation, and UI smoke passed.\n");
  } catch (error) {
    const diagnostic = output.join("").slice(-4_000);
    if (diagnostic) process.stderr.write(diagnostic);
    throw error;
  } finally {
    await stopProcess(child);
    await fs.rm(temporaryProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
