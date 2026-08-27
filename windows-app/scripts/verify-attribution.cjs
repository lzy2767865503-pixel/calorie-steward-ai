"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const windowsRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(windowsRoot, "..");
const read = (relativePath) =>
  fs.readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");

const packageMetadata = JSON.parse(read("windows-app/package.json"));
assert.equal(packageMetadata.author?.name, "LAI ZEYU (来泽宇)");

for (const relativePath of [
  "README.md",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "docs/privacy/windows.md",
  "docs/windows/STORE_LISTING.en.md",
  "docs/windows/STORE_LISTING.zh-CN.md",
  "docs/windows/CERTIFICATION_NOTES.md",
  "docs/windows/TEST_AND_RELEASE_GATES.md",
  "windows-app/electron-builder.config.cjs",
]) {
  const contents = read(relativePath);
  assert.match(contents, /LAI ZEYU/, `${relativePath} is missing LAI ZEYU`);
  assert.match(contents, /来泽宇/, `${relativePath} is missing 来泽宇`);
}

process.stdout.write("Windows attribution gate passed: LAI ZEYU (来泽宇)\n");
