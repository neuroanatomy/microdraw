// The label sets of app/public/labels/ (T002 3.2), as BrainBox lists its
// public/labels/: GET /api/getLabelsets answers [{name, source}], `source`
// being the file name (a project's vectorial layer stores it in `values`).
// The folder is read on each request: it holds a few small files, and a file
// added by the maintainer is listed without a restart. No path comes from the
// request, so nothing outside the folder is ever read.
const fs = require('fs');
const path = require('path');
const log = require('../../log');

const LABELS_DIR = path.join(__dirname, '../../public/labels');

/**
 * The label sets of a folder: its `*.json` files, by file name. A file that
 * is not valid JSON, or has no `name`, is skipped and logged.
 * @param {string} dir The folder
 * @returns {Promise<Array<{name: string, source: string}>>} The label sets
 */
const listLabelSets = async (dir = LABELS_DIR) => {
  const files = (await fs.promises.readdir(dir, { withFileTypes: true }))
    .filter((f) => f.isFile() && f.name.endsWith('.json'))
    .map((f) => f.name)
    .sort();
  const sets = await Promise.all(files.map(async (file) => {
    try {
      const json = JSON.parse(await fs.promises.readFile(path.join(dir, file), 'utf8'));
      if (json === null || typeof json !== 'object' || typeof json.name !== 'string') {
        throw new Error('no name');
      }

      return { name: json.name, source: file };
    } catch (err) {
      log.warn({ err, file }, 'label set skipped: not a valid label set file');

      return null;
    }
  }));

  return sets.filter((s) => s !== null);
};

const getLabelsets = async (req, res) => {
  res.json(await listLabelSets());
};

module.exports = { LABELS_DIR, listLabelSets, getLabelsets };
