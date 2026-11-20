// Rules come from eslint-config-naat (shared with BrainBox, NeuroWebLab and
// nwl-components), pinned in package.json. The overrides below keep
// microdraw's earlier lint result.
module.exports = {
  "env": {
    "browser": true,
    "es2018": true,
    "node": true,
    "mocha": true
  },
  "extends": "naat",
  "parserOptions": {
    // naat sets "latest"; microdraw parses ES2018, as its env says
    "ecmaVersion": 2018,
    "sourceType": "module"
  },
  "rules": {
    // microdraw keeps eslint's default of 10 (naat allows 15)
    "max-statements": ["error", 10],
    // older code still uses var and mixed quotes
    "no-var": "off",
    "quotes": "off"
  }
};
