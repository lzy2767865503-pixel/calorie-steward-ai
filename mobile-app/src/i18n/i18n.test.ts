import assert from "node:assert/strict";
import test from "node:test";

import {
  LANGUAGE_PREFERENCE_SETTING_KEY,
  copy,
  languageFromLocale,
  localeTag,
  resolveLanguage,
} from "./index";

test("system locale resolution supports Simplified and Traditional Chinese", () => {
  assert.equal(languageFromLocale("zh-CN"), "zh");
  assert.equal(languageFromLocale("zh-Hant-HK"), "zh");
  assert.equal(languageFromLocale("en-MY"), "en");
  assert.equal(languageFromLocale(undefined), "en");
});

test("explicit language preference overrides the detected system language", () => {
  assert.equal(LANGUAGE_PREFERENCE_SETTING_KEY, "app.language_preference.v1");
  assert.equal(resolveLanguage("system", "zh"), "zh");
  assert.equal(resolveLanguage("en", "zh"), "en");
  assert.equal(resolveLanguage("zh", "en"), "zh");
});

test("copy and outbound locale stay aligned", () => {
  assert.equal(copy("zh", "中文", "English"), "中文");
  assert.equal(copy("en", "中文", "English"), "English");
  assert.equal(localeTag("zh"), "zh-CN");
  assert.equal(localeTag("en"), "en-US");
});
