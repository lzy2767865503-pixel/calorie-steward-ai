"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "dist-web");
const required = ["index.html", "favicon.ico", "_expo/static/js/web"];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) {
    throw new Error(`Missing Windows web export path: ${relative}`);
  }
}
const wasm = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(candidate);
    else if (entry.name.endsWith(".wasm")) wasm.push(candidate);
  }
}
walk(root);
if (wasm.length < 1) throw new Error("Expo SQLite WASM was not exported.");
process.stdout.write(`Verified Windows web export with ${wasm.length} WASM asset(s).\n`);
