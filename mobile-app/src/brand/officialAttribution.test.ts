import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  OFFICIAL_ATTRIBUTION_EN,
  OFFICIAL_ATTRIBUTION_ZH,
  OFFICIAL_DEVELOPER_NAME_CHINESE,
  OFFICIAL_DEVELOPER_NAME_LATIN,
  officialAttribution,
} from "./officialAttribution";

test("official bilingual attribution keeps the developer's exact identity", () => {
  assert.equal(OFFICIAL_DEVELOPER_NAME_LATIN, "LAI ZEYU");
  assert.equal(OFFICIAL_DEVELOPER_NAME_CHINESE, "来泽宇");
  assert.equal(officialAttribution("en"), "Developed by LAI ZEYU 来泽宇");
  assert.equal(officialAttribution("zh"), "由 LAI ZEYU 来泽宇 开发");
  assert.match(OFFICIAL_ATTRIBUTION_EN, /LAI ZEYU 来泽宇/);
  assert.match(OFFICIAL_ATTRIBUTION_ZH, /LAI ZEYU 来泽宇/);
});

test("official app surfaces and native metadata retain the attribution", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const appConfig = JSON.parse(read("app.json")) as { expo: { extra: { officialDeveloper: string } } };
  assert.equal(appConfig.expo.extra.officialDeveloper, "LAI ZEYU 来泽宇");
  assert.match(read("App.tsx"), /officialAttribution\(language\)/);
  assert.match(read("src/screens/HomeScreen.tsx"), /officialAttribution\(language\)/);
  assert.match(read("src/screens/SettingsScreen.tsx"), /officialAttribution\(language\)/);
  assert.match(
    read("android/app/src/main/AndroidManifest.xml"),
    /com\.laisystems\.dietsteward\.OFFICIAL_DEVELOPER/,
  );
  assert.match(read("ios/app/Info.plist"), /LAIOfficialDeveloper/);
});
