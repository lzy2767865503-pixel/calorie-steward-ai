const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker ships a WebAssembly binary. Metro does not treat
// `.wasm` as an asset by default, so web/Windows exports cannot resolve it
// unless the extension is added explicitly.
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}

module.exports = config;
