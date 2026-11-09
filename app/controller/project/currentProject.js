/**
 * The current version of a project (T002 2.1a). A project's old versions are
 * kept as documents with the same shortname and `backup: true`; the current
 * one has no `backup` field. Every read of a project by shortname goes
 * through here, so that nothing shows or acts on an old version.
 *
 * There should be one current document per shortname. If there are several
 * (a race between two saves), the newest `_id` wins, so that every read gives
 * the same answer. The `{shortname: 1}` index (indexes.js) serves the query.
 */

const CURRENT = { backup: { $exists: false } };

// Find options: of several current documents, the newest `_id` first
const NEWEST_FIRST = { sort: { _id: -1 } };

/**
 * Read the current version of a project
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {string} shortname The project's shortname
 * @returns {Promise<object|null>} The project, or null if there is none or
 *   the shortname is not a string (NWL queryProject answered undefined)
 */
const findCurrentProject = (db, shortname) => {
  if (typeof shortname !== 'string') {
    return Promise.resolve(null);
  }

  return db.collection('projects').findOne({ shortname, ...CURRENT }, NEWEST_FIRST);
};

module.exports = { CURRENT, NEWEST_FIRST, findCurrentProject };
