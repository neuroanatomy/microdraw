/**
 * One document per dataset (T002 3.3), in the `datasets` collection. A
 * dataset is a source JSON URL, with 1 to thousands of slices; it is what is
 * added to projects (`files.list[].source`). The document is created the first
 * time a dataset is saved in a project (saveProjectVersion, currentProject.js),
 * and never deleted, as BrainBox's `mri` documents:
 *   { source, name, owner, included }
 * - source: the URL, exactly as in `files.list[].source`;
 * - name: the name the project row gave it then, or the last path segment of
 *   the URL without `.json`;
 * - owner: the user whose save added it first (for an admin action, the
 *   project's owner);
 * - included: when the document was created (ISO string, as BrainBox).
 * Per-project names stay in each project's `files.list`, annotations stay per
 * project. Only http(s) URLs are datasets: a bare file name or an empty
 * source gets no document.
 *
 * Creation is an upsert with $setOnInsert: the first document stays as it
 * is; the unique index on `source` (indexes.js) keeps two simultaneous saves
 * from creating two.
 */
const _ = require('lodash');

const DATASETS = 'datasets';

/**
 * Whether a source is a dataset: an http(s) URL
 * @param {*} source A `files.list` source
 * @returns {boolean} true for an http(s) URL
 */
const isDatasetSource = (source) => {
  if (typeof source !== 'string' || source.trim() !== source || source === '') {
    return false;
  }
  try {
    const { protocol } = new URL(source);

    return protocol === 'http:' || protocol === 'https:';
  } catch (err) {
    return false;
  }
};

/**
 * The rows of a project's file list as { source, name }: plain string
 * entries (stored before files were objects) are a source without a name
 * @param {object} project A project document (or null)
 * @returns {Array<object>} [{ source, name }]
 */
const fileRows = (project) => {
  const list = (project && _.isPlainObject(project.files) && Array.isArray(project.files.list)) ? project.files.list : [];

  return list.map((row) => {
    if (typeof row === 'string') {
      return { source: row, name: '' };
    }
    if (_.isPlainObject(row)) {
      return { source: row.source, name: typeof row.name === 'string' ? row.name : '' };
    }

    return { source: null, name: '' };
  });
};

/**
 * The name of a dataset without one: the last segment of its URL's path,
 * without `.json`
 * @param {string} source An http(s) URL
 * @returns {string} The name
 */
const defaultName = (source) => {
  const segments = new URL(source).pathname.split('/')
    .filter((s) => s !== '');
  let last = segments.length > 0 ? segments[segments.length - 1] : '';
  try {
    last = decodeURIComponent(last);
  } catch (err) {
    // a malformed escape: kept as it is
  }

  return last.replace(/\.json$/i, '');
};

/**
 * The name a document gets from a project row
 * @param {object} row { source, name }
 * @returns {string} The row's name, or defaultName
 */
const datasetName = (row) => (row.name.trim() === '' ? defaultName(row.source) : row.name);

/**
 * The datasets a new version of a project adds: the rows of `next` with an
 * http(s) source that `previous` does not list, one per source (its first
 * row)
 * @param {object} previous The current version before the save (or null)
 * @param {object} next The new version
 * @returns {Array<object>} [{ source, name }]
 */
const addedDatasets = (previous, next) => {
  const before = new Set(fileRows(previous).map((r) => r.source));

  return _.uniqBy(fileRows(next).filter((r) => isDatasetSource(r.source) && !before.has(r.source)), 'source');
};

/**
 * Create the documents of datasets that have none; existing ones are not
 * changed
 * @param {object} db Native MongoDB Db
 * @param {Array<object>} rows [{ source, name }], http(s) sources
 * @param {object} options { owner, included: ISO date (default now) }
 * @returns {Promise<number>} The number of documents created
 */
const createDatasets = async (db, rows, { owner, included = (new Date()).toJSON() }) => {
  if (rows.length === 0) {
    return 0;
  }
  const ops = rows.map((row) => ({
    updateOne: {
      filter: { source: row.source },
      update: { $setOnInsert: { source: row.source, name: datasetName(row), owner, included } },
      upsert: true
    }
  }));
  try {
    const result = await db.collection(DATASETS).bulkWrite(ops, { ordered: false });

    return result.upsertedCount;
  } catch (err) {
    // two simultaneous upserts of a new source: the unique index refuses the
    // second insert, and the document exists. Any other error is thrown.
    const errors = (err.writeErrors || []);
    if (err.code === 11000 || (errors.length > 0 && errors.every((e) => e.code === 11000))) {
      return err.result && typeof err.result.upsertedCount === 'number' ? err.result.upsertedCount : 0;
    }
    throw err;
  }
};

module.exports = { DATASETS, addedDatasets, createDatasets, datasetName, defaultName, fileRows, isDatasetSource };
