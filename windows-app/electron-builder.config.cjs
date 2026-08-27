"use strict";

const storeBuild = process.env.CALORIE_STORE_BUILD === "1";
const trustedGithubBuild =
  process.env.CALORIE_TRUSTED_GITHUB_BUILD === "1";
const identityName = process.env.WINDOWS_IDENTITY_NAME;
const publisher = process.env.WINDOWS_PUBLISHER;
const expectedPartnerIdentityName =
  "LAIZEYU.CalorieStewardbyLAIZEYU";
const expectedPartnerPublisher =
  "CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8";

if (storeBuild && trustedGithubBuild) {
  throw new Error("Store and trusted GitHub packaging modes are mutually exclusive.");
}

if (storeBuild && (!identityName || !publisher)) {
  throw new Error(
    "Store packaging requires WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER from Partner Center.",
  );
}

if (
  storeBuild &&
  (publisher !== expectedPartnerPublisher ||
    identityName !== expectedPartnerIdentityName)
) {
  throw new Error(
    "Store packaging requires the reserved production IdentityName and this account's exact Partner Center Publisher.",
  );
}

module.exports = {
  appId: "com.laisystems.caloriesteward.windows",
  productName: "Calorie Steward by LAI ZEYU",
  copyright: "Copyright © 2026 LAI ZEYU (来泽宇)",
  artifactName: "Calorie-Steward-Windows-${version}-${arch}.${ext}",
  asar: true,
  afterPack: "./scripts/after-pack.cjs",
  forceCodeSigning: trustedGithubBuild,
  compression: "maximum",
  electronLanguages: ["en-US", "zh-CN"],
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
  extraResources: [
    { from: "../LICENSE", to: "legal/LICENSE" },
    { from: "../NOTICE", to: "legal/NOTICE" },
    {
      from: "../THIRD_PARTY_NOTICES.md",
      to: "legal/THIRD_PARTY_NOTICES.md",
    },
  ],
  extraMetadata: {
    name: "calorie-steward-windows",
  },
  win: {
    icon: "build/icon.ico",
    legalTrademarks: "Calorie Steward is authored by LAI ZEYU (来泽宇).",
    target: storeBuild ? ["appx"] : ["nsis", "zip"],
    verifyUpdateCodeSignature: true,
    signExts: trustedGithubBuild ? [".dll", ".node"] : null,
    signtoolOptions: trustedGithubBuild
      ? {
          sign: require.resolve("./scripts/esigner-sign.cjs"),
          signingHashAlgorithms: ["sha256"],
          publisherName: ["LAI ZEYU", "来泽宇"],
          rfc3161TimeStampServer: "http://ts.ssl.com",
        }
      : null,
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
