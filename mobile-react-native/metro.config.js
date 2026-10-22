const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const dependencies = fs.realpathSync(path.join(__dirname, 'node_modules'));
const fileMapCacheDirectory = path.join(__dirname, '.verify', 'metro-file-map');
fs.mkdirSync(fileMapCacheDirectory, {recursive: true});
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  maxWorkers: 1,
  watchFolders: [dependencies],
  resolver: {nodeModulesPaths: [dependencies]},
  fileMapCacheDirectory,
});
