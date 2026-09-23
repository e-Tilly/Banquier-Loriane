// Path aliases are handled by Metro (see metro.config.js `extraNodeModules`), so there is no
// babel module-resolver here — one aliasing mechanism, not two that can disagree.
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
