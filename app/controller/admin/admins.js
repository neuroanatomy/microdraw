const path = require('path');
const { createAdmins } = require('neuroweblab');
const logger = require('../../log');

// The admins list, read once from the "admins" field of cfg.json (NeuroWebLab
// createAdmins, shared with BrainBox). microdraw reads the config from
// CFG_PATH when it is set (the tests pin cfg.json.example), as app.js does.
// Exports getAdmins, setAdmins (used by the tests), isAdmin, requestUsername,
// requireAdmin and adminPage, all reading the same list.
module.exports = createAdmins({
  cfgPath: process.env.CFG_PATH || path.join(__dirname, '../../../cfg.json'),
  logger
});
