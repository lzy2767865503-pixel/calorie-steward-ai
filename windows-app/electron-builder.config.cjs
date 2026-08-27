"use strict";

const storeBuild = process.env.CALORIE_STORE_BUILD === "1";
const identityName = process.env.WINDOWS_IDENTITY_NAME;
const publisher = process.env.WINDOWS_PUBLISHER;

if (storeBuild && (!identityName || !publisher)) {
  throw new Error(
    "Store packaging requires WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER from Partner Center.",
  );
}

module.exports = {
  appId: "com.laisystems.caloriesteward.windows",
  productName: "Calorie Steward by LAI ZEYU",
  copyright: "Copyright © 2026 LAI ZEYU (来泽宇)",
  artifactName: "Calorie-Steward-Windows-${version}-${arch}.${ext}",
  asar: true,
  afterPack: "./scripts/after-pack.cjs",
  compression: "maximum",
  electronLanguages: ["en", "zh_CN"],
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: [
    "electron/**/*.cjs",
    "dist-web/**/*",
    "package.json",
    "!**/*.map",
    "!**/test/**",
    "!**/scripts/**",
  ],
  extraMetadata: {
    name: "calorie-steward-windows",
  },
  win: {
    icon: "build/icon.ico",
    legalTrademarks: "Calorie Steward is authored by LAI ZEYU (来泽宇).",
    target: storeBuild ? ["appx"] : ["nsis", "zip"],
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: true,
  },
  appx: {
    identityName: identityName || "LAIZEYU.CalorieStewardWindowsDevelopment",
    publisher: publisher || "CN=DEVELOPMENT-ONLY-NOT-FOR-DISTRIBUTION",
    publisherDisplayName: "LAI ZEYU",
    applicationId: "CalorieSteward",
    displayName: "Calorie Steward by LAI ZEYU",
    backgroundColor: "#062E6F",
    languages: ["en-US", "zh-CN"],
    showNameOnTiles: true,
    setBuildNumber: false,
  },
  publish: null,
};
