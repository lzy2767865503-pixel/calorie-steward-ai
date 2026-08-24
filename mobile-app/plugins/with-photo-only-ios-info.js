const { withInfoPlist } = require("@expo/config-plugins");

module.exports = function withPhotoOnlyIosInfo(config) {
  return withInfoPlist(config, (modConfig) => {
    delete modConfig.modResults.NSMicrophoneUsageDescription;
    return modConfig;
  });
};
