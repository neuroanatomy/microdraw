// The label sets of app/public/labels/ (T002 3.2), as BrainBox lists its
// public/labels/: GET /api/getLabelsets answers [{name, source}], `source`
// being the file name (a project's vectorial layer stores it in `values`).
// The listing is NeuroWebLab's (routes/labelSets.js); the folder is read on
// each request, so a file added by the maintainer is listed without a restart.
const path = require('path');
const nwl = require('neuroweblab');
const log = require('../../log');

const LABELS_DIR = path.join(__dirname, '../../public/labels');

// The default label set (the viewer's fallback, and the one a new vectorial
// layer gets in the settings: nwl-components takes the first of the list)
// comes first, whatever the other file names (T002 3.5).
const DEFAULT_SOURCE = '10regions.json';

/**
 * The label sets of a folder: its valid `*.json` files, 10regions.json first,
 * then by file name (NeuroWebLab's listLabelSets)
 * @param {string} [dir] The folder; app/public/labels/ by default
 * @returns {Promise<Array<{name: string, source: string}>>} The label sets
 */
const listLabelSets = (dir = LABELS_DIR) => nwl.listLabelSets(dir, { first: DEFAULT_SOURCE, logger: log });

module.exports = { LABELS_DIR, DEFAULT_SOURCE, listLabelSets };
