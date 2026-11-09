/**
 * The current version of a project (T002 2.1a). A project's old versions are
 * kept as documents with the same shortname and `backup: true`; the current
 * one has no `backup` field. Every read of a project by shortname goes
 * through here, so that nothing shows or acts on an old version.
 *
 * There should be one current document per shortname. If there are several
 * (a race between two saves), the newest `_id` wins, so that every read gives
 * the same answer. The `{shortname: 1}` index (indexes.js) serves the query.
 *
 * Every change of a project writes a new version (T002 2.1b,
 * saveProjectVersion): old versions are never changed again, only marked.
 */

const _ = require('lodash');

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

/**
 * Store a new version of a project (T002 2.1b): insert it as a new document,
 * then mark every other current document of its shortname `backup: true`.
 * Insert first: a failure between the two writes leaves two current versions
 * (reads take the newest, findCurrentProject; the next save leaves one),
 * never none. The caller holds the project's lock (projectLock.js).
 *
 * A change that is not a user's edit (the stored-project migration, T002
 * 2.4, scripts/migrate-projects.js) passes `keepModified`: the version keeps
 * the `modified` and `modifiedBy` of `doc` (or keeps them absent), so that the
 * user page's "Last modified" does not change.
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {object} doc The project; an `_id` or `backup` in it is ignored
 * @param {object} options { by: the username stored as `modifiedBy`;
 *   keepModified: true to keep `doc`'s `modified` and `modifiedBy` instead }
 * @returns {Promise<object>} The document as stored, with its new `_id`
 */
const saveProjectVersion = async (db, doc, { by, keepModified = false }) => {
  // an ISO string, as before 2.1b and as BrainBox
  const version = keepModified ?
    _.omit(doc, ['_id', 'backup']) :
    { ..._.omit(doc, ['_id', 'backup']), modified: (new Date()).toJSON(), modifiedBy: by };
  const projects = db.collection('projects');
  await projects.insertOne(version); // sets version._id
  await projects.updateMany(
    { shortname: version.shortname, ...CURRENT, _id: { $ne: version._id } },
    { $set: { backup: true } }
  );

  return version;
};

/**
 * The current versions of the projects a user owns or is a collaborator of,
 * the collaborator row naming the user by `username` or `userID` (T002 2.2;
 * NWL's queryUserProjects, used before, matched `username` only)
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {string} username The user
 * @returns {Promise<Array<object>>} The projects, in natural order as NWL's
 */
const findUserProjects = (db, username) => db.collection('projects')
  .find({
    $or: [
      { owner: username },
      { 'collaborators.list.username': username },
      { 'collaborators.list.userID': username }
    ],
    ...CURRENT
  })
  .toArray();

module.exports = { CURRENT, NEWEST_FIRST, findCurrentProject, findUserProjects, saveProjectVersion };
