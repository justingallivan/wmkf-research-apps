/** JSX-only loader for the local reviewer reminder rehearsal. */
const babel = require('next/dist/compiled/babel/core');
const reactPreset = require('next/dist/compiled/babel/preset-react');

module.exports = function jsxLoader(source) {
  return babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    presets: [[reactPreset, { runtime: 'automatic' }]],
    filename: this.resourcePath,
  }).code;
};
