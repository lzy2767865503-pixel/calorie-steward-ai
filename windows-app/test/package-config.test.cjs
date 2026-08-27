"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const metadata = require("../package.json");
const config = require("../electron-builder.config.cjs");
const afterPack = require("../scripts/after-pack.cjs");
const { FuseV1Options } = require("@electron/fuses");

test("desktop bridge and package metadata use the same release version", () => {
  const preload = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
  assert.match(preload, new RegExp(`version: [\"']${metadata.version.replaceAll(".", "\\.")}[\"']`));
});

test("Windows package config is hardened and Store identity is injected", () => {
  assert.equal(metadata.author.name, "LAI ZEYU (来泽宇)");
  assert.match(config.copyright, /LAI ZEYU \(来泽宇\)/);
  assert.match(config.win.legalTrademarks, /LAI ZEYU \(来泽宇\)/);
  assert.equal(config.asar, true);
  assert.equal(config.win.icon, "build/icon.ico");
  assert.deepEqual(config.win.target, ["nsis", "zip"]);
  assert.equal(config.appx.applicationId, "CalorieSteward");
  assert.equal(config.appx.publisherDisplayName, "LAI ZEYU");
  assert.deepEqual(config.appx.languages, ["en-US", "zh-CN"]);
  assert.deepEqual(config.electronLanguages, ["en-US", "zh-CN"]);
  assert.deepEqual(
    config.extraResources.map((entry) => entry.to),
    ["legal/LICENSE", "legal/NOTICE", "legal/THIRD_PARTY_NOTICES.md"],
  );
  assert.equal(config.afterPack, "./scripts/after-pack.cjs");
  assert.equal(afterPack.fuseConfiguration.strictlyRequireAllFuses, true);
  assert.equal(
    afterPack.fuseConfiguration[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot],
    false,
  );
});

test("Store packaging fails closed without Partner Center identity", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./electron-builder.config.cjs')"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CALORIE_STORE_BUILD: "1",
        WINDOWS_IDENTITY_NAME: "",
        WINDOWS_PUBLISHER: "",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER/);
});
