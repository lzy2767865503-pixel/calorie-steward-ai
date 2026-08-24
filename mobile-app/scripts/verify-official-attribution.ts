import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  OFFICIAL_ATTRIBUTION_EN,
  OFFICIAL_ATTRIBUTION_ZH,
  OFFICIAL_DEVELOPER_NAME_CHINESE,
  OFFICIAL_DEVELOPER_NAME_LATIN,
} from "../src/brand/officialAttribution";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  readFileSync(resolve(projectRoot, relativePath), "utf8");

assert.equal(OFFICIAL_DEVELOPER_NAME_LATIN, "LAI ZEYU");
assert.equal(OFFICIAL_DEVELOPER_NAME_CHINESE, "来泽宇");
assert.equal(OFFICIAL_ATTRIBUTION_EN, "Developed by LAI ZEYU 来泽宇");
assert.equal(OFFICIAL_ATTRIBUTION_ZH, "由 LAI ZEYU 来泽宇 开发");

for (const [relativePath, requiredPattern] of [
  ["App.tsx", /bootCredit[^}]*}>\{officialAttribution\(language\)\}/s],
  ["src/screens/ApiSetupScreen.tsx", /developerCredit[^}]*}>\{officialAttribution\(language\)\}/s],
  ["src/screens/HomeScreen.tsx", /developerCredit[^}]*}>\{officialAttribution\(language\)\}/s],
  ["src/screens/SettingsScreen.tsx", /developerAttribution[^}]*}>\{officialAttribution\(language\)\}/s],
] as const) {
  assert.match(
    read(relativePath),
    requiredPattern,
    `${relativePath} must render the official developer attribution`,
  );
}

const appConfig = JSON.parse(read("app.json")) as {
  expo?: {
    name?: string;
    slug?: string;
    version?: string;
    ios?: { bundleIdentifier?: string; buildNumber?: string };
    android?: { package?: string; versionCode?: number };
    extra?: { officialDeveloper?: string };
    plugins?: Array<string | [string, Record<string, unknown>]>;
  };
};
assert.equal(appConfig.expo?.name, "Calorie Steward");
assert.equal(appConfig.expo?.slug, "calorie-steward");
assert.equal(appConfig.expo?.version, "1.2.2");
assert.equal(appConfig.expo?.android?.package, "com.laisystems.dietsteward");
assert.equal(appConfig.expo?.android?.versionCode, 6);
assert.equal(appConfig.expo?.ios?.bundleIdentifier, "com.laisystems.dietsteward");
assert.equal(appConfig.expo?.ios?.buildNumber, "6");
assert.equal(appConfig.expo?.extra?.officialDeveloper, "LAI ZEYU 来泽宇");
const cameraPlugin = appConfig.expo?.plugins?.find(
  (plugin): plugin is [string, Record<string, unknown>] =>
    Array.isArray(plugin) && plugin[0] === "expo-camera",
);
assert.equal(cameraPlugin?.[1]?.barcodeScannerEnabled, false);
const androidConfigPlugin = read("plugins/with-private-android-manifest.js");
assert.match(androidConfigPlugin, /withAppBuildGradle/);
assert.match(androidConfigPlugin, /withDangerousMod/);
assert.match(androidConfigPlugin, /com\.laisystems\.dietsteward\.OFFICIAL_DEVELOPER/);
assert.match(androidConfigPlugin, /values-zh/);
assert.match(androidConfigPlugin, /verifyNoBarcodeRuntimeDependencies/);
assert.match(androidConfigPlugin, /play-services-code-scanner/);
assert.match(androidConfigPlugin, /com\.google\.mlkit[^\n]*barcode-scanning/);
assert.match(androidConfigPlugin, /androidx\.camera[^\n]*camera-mlkit-vision/);
assert.match(
  read("android/app/src/main/AndroidManifest.xml"),
  /android:name="com\.laisystems\.dietsteward\.OFFICIAL_DEVELOPER" android:value="@string\/official_developer"/,
);

assert.match(
  read("android/app/src/main/res/values/strings.xml"),
  /name="official_developer">Developed by LAI ZEYU 来泽宇</,
);
assert.match(
  read("android/app/src/main/res/values-en/strings.xml"),
  /name="official_developer">Developed by LAI ZEYU 来泽宇</,
);
assert.match(
  read("android/app/src/main/res/values-zh/strings.xml"),
  /name="official_developer">由 LAI ZEYU 来泽宇 开发</,
);
const androidBuildGradle = read("android/app/build.gradle");
assert.match(androidBuildGradle, /versionCode 6/);
assert.match(androidBuildGradle, /versionName ["']1\.2\.2["']/);
assert.match(androidBuildGradle, /diet-steward-managed-android-configuration/);
assert.match(androidBuildGradle, /tasks\.register\('verifyOfficialAttribution', Exec\)/);
assert.match(androidBuildGradle, /tasks\.register\('verifyBilingualUi', Exec\)/);
assert.match(androidBuildGradle, /tasks\.register\('verifyNoBarcodeRuntimeDependencies'\)/);
for (const environmentVariable of [
  "DIET_RELEASE_STORE_FILE",
  "DIET_RELEASE_STORE_PASSWORD",
  "DIET_RELEASE_KEY_ALIAS",
  "DIET_RELEASE_KEY_PASSWORD",
]) {
  assert.match(androidBuildGradle, new RegExp(`System\\.getenv\\('${environmentVariable}'\\)`));
}
assert.doesNotMatch(
  androidBuildGradle,
  /release\s*\{[\s\S]{0,500}?signingConfig signingConfigs\.debug/,
  "Android release builds must never use the debug signing configuration",
);
assert.match(read("ios/app/en.lproj/InfoPlist.strings"), /Developed|Calorie Steward/);
assert.match(read("ios/app/zh-Hans.lproj/InfoPlist.strings"), /卡路里管家/);
assert.match(read("ios/app/Info.plist"), /<key>LAIOfficialDeveloper<\/key>\s*<string>LAI ZEYU 来泽宇<\/string>/);
assert.match(read("ios/app/Info.plist"), /<key>CFBundleShortVersionString<\/key>\s*<string>1\.2\.2<\/string>/);
assert.match(read("ios/app/Info.plist"), /<key>CFBundleVersion<\/key>\s*<string>6<\/string>/);
assert.match(read("src/screens/SettingsScreen.tsx"), /卡路里管家 v1\.2\.2|Calorie Steward v1\.2\.2/);

process.stdout.write("Official attribution gate passed: LAI ZEYU 来泽宇\n");
