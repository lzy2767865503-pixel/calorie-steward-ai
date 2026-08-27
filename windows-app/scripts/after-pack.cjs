"use strict";

const path = require("node:path");
const {
  flipFuses,
  FuseVersion,
  FuseV1Options,
} = require("@electron/fuses");

const fuseConfiguration = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // electron-builder's Electron 44 Windows payload contains the shared
  // v8_context_snapshot.bin, not browser_v8_context_snapshot.bin. Enabling
  // this compatibility fuse makes the packaged browser process fail before
  // JavaScript starts, so it must remain disabled for this distribution.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
});

async function hardenPackagedElectron(context) {
  if (context.electronPlatformName !== "win32") return;
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  await flipFuses(executable, fuseConfiguration);
}

hardenPackagedElectron.fuseConfiguration = fuseConfiguration;
module.exports = hardenPackagedElectron;
