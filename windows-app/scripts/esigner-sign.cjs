"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const allowedExtensions = new Set([".dll", ".exe", ".node"]);
const SIGNING_TIMEOUT_MS = 10 * 60 * 1000;
let signingQueue = Promise.resolve();

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Trusted eSigner build requires ${name}.`);
  }
  return value;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    digest.on("error", reject);
    digest.on("finish", () => resolve(digest.digest("hex")));
    input.pipe(digest);
  });
}

function readPeHeader(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(2);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) {
      return "";
    }
    return header.toString("ascii");
  } finally {
    fs.closeSync(descriptor);
  }
}

function run(javaExecutable, args, workingDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExecutable, args, {
      shell: false,
      windowsHide: true,
      cwd: workingDirectory,
      stdio: "ignore",
    });
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 30_000,
          windowsHide: true,
        });
      } else {
        child.kill("SIGKILL");
      }
      if (!settled) {
        settled = true;
        reject(new Error("SSL.com CodeSignTool exceeded its 10 minute hard timeout."));
      }
    }, SIGNING_TIMEOUT_MS);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("SSL.com CodeSignTool exceeded its 10 minute hard timeout."));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `SSL.com CodeSignTool failed with exit code ${code}; tool output is intentionally suppressed to protect credentials.`,
        ),
      );
    });
  });
}

async function signOne(configuration) {
  if (process.platform !== "win32") {
    throw new Error("Trusted eSigner packaging must run on Windows.");
  }
  if (process.env.CALORIE_TRUSTED_GITHUB_BUILD !== "1") {
    throw new Error("Refusing to invoke eSigner outside the trusted GitHub build mode.");
  }
  if (!configuration || configuration.hash !== "sha256" || configuration.isNest) {
    throw new Error("The trusted release permits one SHA-256 Authenticode signing pass only.");
  }

  const binaryPath = path.resolve(configuration.path);
  const extension = path.extname(binaryPath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new Error(`Refusing to sign an unexpected file type: ${extension || "(none)"}`);
  }
  const stat = fs.lstatSync(binaryPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("The eSigner target must be a regular non-symlink file.");
  }
  const header = readPeHeader(binaryPath);
  if (extension !== ".msi" && header !== "MZ") {
    throw new Error("The eSigner target is not a Windows PE binary.");
  }

  const javaHome = requiredEnvironment("JAVA_HOME");
  const javaExecutable = path.join(javaHome, "bin", "java.exe");
  const toolJar = path.resolve(requiredEnvironment("CALORIE_CODESIGNTOOL_JAR"));
  if (!fs.existsSync(javaExecutable) || !fs.existsSync(toolJar)) {
    throw new Error("Pinned Java or SSL.com CodeSignTool is missing.");
  }
  const runnerTemp = path.resolve(requiredEnvironment("RUNNER_TEMP"));
  const toolRelativePath = path.relative(runnerTemp, toolJar);
  if (toolRelativePath.startsWith("..") || path.isAbsolute(toolRelativePath)) {
    throw new Error("CodeSignTool must be extracted below RUNNER_TEMP.");
  }

  const username = requiredEnvironment("SSL_ESIGNER_USERNAME");
  const password = requiredEnvironment("SSL_ESIGNER_PASSWORD");
  const credentialId = requiredEnvironment("SSL_ESIGNER_CREDENTIAL_ID");
  const totpSecret = requiredEnvironment("SSL_ESIGNER_TOTP_SECRET");
  const hashBefore = await sha256(binaryPath);
  // CodeSignTool's documented extension allowlist does not include Electron's
  // native `.node` suffix. Authenticode signs the PE bytes, not the suffix, so
  // sign an exclusive DLL-named copy and copy the exact signed bytes back.
  const signingTarget = extension === ".node"
    ? `${binaryPath}.calorie-esigner-${process.pid}-${Date.now()}.dll`
    : binaryPath;
  if (signingTarget !== binaryPath) {
    fs.copyFileSync(binaryPath, signingTarget, fs.constants.COPYFILE_EXCL);
  }
  try {
    const signingTargetHashBefore = await sha256(signingTarget);
    await run(
      javaExecutable,
      [
        "-Xmx1024M",
        "-jar",
        toolJar,
        "sign",
        `-username=${username}`,
        `-password=${password}`,
        `-credential_id=${credentialId}`,
        `-totp_secret=${totpSecret}`,
        "-program_name=Calorie Steward by LAI ZEYU",
        `-input_file_path=${signingTarget}`,
        "-malware_block",
        "-override",
      ],
      path.dirname(path.dirname(toolJar)),
    );
    if (!fs.existsSync(signingTarget) || (await sha256(signingTarget)) === signingTargetHashBefore) {
      throw new Error("CodeSignTool returned success without changing the target PE.");
    }
    if (signingTarget !== binaryPath) {
      fs.copyFileSync(signingTarget, binaryPath);
    }
    if (!fs.existsSync(binaryPath) || (await sha256(binaryPath)) === hashBefore) {
      throw new Error("eSigner returned without changing the original target PE.");
    }
  } finally {
    if (signingTarget !== binaryPath) {
      fs.rmSync(signingTarget, { force: true });
    }
  }
}

module.exports = function signWithSslDotCom(configuration) {
  signingQueue = signingQueue.then(() => signOne(configuration));
  return signingQueue;
};
