"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const exportRoot = path.join(projectRoot, "dist-web");
const sourceIcon = path.join(projectRoot, "build", "icon.ico");
const destinationIcon = path.join(exportRoot, "favicon.ico");

if (!fs.existsSync(path.join(exportRoot, "index.html"))) {
  throw new Error("Expo export is missing index.html.");
}
if (!fs.existsSync(sourceIcon)) {
  throw new Error("Windows icon is missing.");
}
fs.copyFileSync(sourceIcon, destinationIcon);
process.stdout.write("Prepared Windows web export assets.\n");
