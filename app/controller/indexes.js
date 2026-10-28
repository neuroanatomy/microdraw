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

/**
 * Create the app's indexes if they are missing
 * @param {object} db Monk database
 * @returns {Promise<void>} Resolves once done; never rejects
 */
const ensureIndexes = async (db) => {
  try {
    await db.get('annotations').createIndex({ project: 1, _id: -1 }, { name: ANNOTATIONS_PROJECT_INDEX });
  } catch (err) {
    log.warn({ err, index: ANNOTATIONS_PROJECT_INDEX }, 'cannot create the annotations index');
  }
};

module.exports = { ensureIndexes, ANNOTATIONS_PROJECT_INDEX };
