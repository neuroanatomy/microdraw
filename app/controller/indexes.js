/**
 * Indexes the app needs, created once at startup (app.js, after nwl.init).
 * createIndex is idempotent: an index that exists with the same keys and name
 * is left as it is. Any error (e.g. the same keys under another name) is
 * logged and does not stop the app: the queries still work, only slower.
 */
const log = require('../log');

// The user page's "Last modified": the newest annotation of each listed
// project (user/lastModified.js newestAnnotations), $match on project then $max
// of _id. Without it, every user-page load scans the whole collection.
const ANNOTATIONS_PROJECT_INDEX = 'project_1__id_-1';

// Values of text layers (textAnnotations.js): reads and writes go by
// (project, source, layer), readers take the newest current document by _id.
const TEXT_ANNOTATIONS_INDEX = 'project_1_source_1_layer_1__id_-1';

// Projects by shortname (project/currentProject.js): every project read. Not
// unique: a project's old versions keep its shortname (T002 2.1), as in
// BrainBox, whose `project` collection has the same index and name.
const PROJECTS_SHORTNAME_INDEX = 'shortname_1';

/**
 * Create the app's indexes if they are missing
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @returns {Promise<void>} Resolves once done; never rejects
 */
const ensureIndexes = async (db) => {
  try {
    await db.collection('annotations').createIndex({ project: 1, _id: -1 }, { name: ANNOTATIONS_PROJECT_INDEX });
  } catch (err) {
    log.warn({ err, index: ANNOTATIONS_PROJECT_INDEX }, 'cannot create the annotations index');
  }
  try {
    await db.collection('textAnnotations').createIndex({ project: 1, source: 1, layer: 1, _id: -1 }, { name: TEXT_ANNOTATIONS_INDEX });
  } catch (err) {
    log.warn({ err, index: TEXT_ANNOTATIONS_INDEX }, 'cannot create the textAnnotations index');
  }
  try {
    await db.collection('projects').createIndex({ shortname: 1 }, { name: PROJECTS_SHORTNAME_INDEX });
  } catch (err) {
    log.warn({ err, index: PROJECTS_SHORTNAME_INDEX }, 'cannot create the projects index');
  }
};

module.exports = { ensureIndexes, ANNOTATIONS_PROJECT_INDEX, TEXT_ANNOTATIONS_INDEX, PROJECTS_SHORTNAME_INDEX };
