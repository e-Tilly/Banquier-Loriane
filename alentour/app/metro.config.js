// Lets the app import the shared catalog engine from ../src without duplicating it.
// One implementation of "what matches" and "what ranks first", used by both the app and
// the export tool.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@core": path.resolve(workspaceRoot, "src"),
};
module.exports = config;
