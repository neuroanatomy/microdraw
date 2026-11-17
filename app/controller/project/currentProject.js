/**
 * The current version of a project (T002 2.1a). A project's old versions are
 * kept as documents with the same shortname and `backup: true`; the current
 * one has no `backup` field. Every read of a project by shortname goes
 * through here, so that nothing shows or acts on an old version.
 *
 * The versioning is NeuroWebLab's (1.16.0, project/versions.js, stage 4 merge
 * M9): `CURRENT`, `NEWEST_FIRST`, `findCurrentProject` and the two writes of
 * a save (insert the new version, then mark the others `backup: true`). It
 * reads the configured `projectsCollection`, `projects` here (app.js; the
 * scripts set it in check-projects.js quietInit). The `{shortname: 1}` index
 * (indexes.js) serves the queries.
 *
 * What stays microdraw's: the dataset documents a save creates (T002 3.3,
 * recordDatasets, run after the save by NWL's `afterSave`) and
 * `findUserProjects`. The exports and their signatures are unchanged.
 */

const nwl = require('neuroweblab');
const log = require('../../log');
const { addedDatasets, createDatasets } = require('../datasets');

const { CURRENT, NEWEST_FIRST, findCurrentProject } = nwl;

/**
 * Create the documents of the datasets a project version adds (T002 3.3).
 * Never rejects: a failure is logged, the version is saved already.
 * @param {object} db Native MongoDB Db
 * @param {object} previous The current version before the save (or null)
 * @param {object} version The version saved
 * @param {string} owner The owner of the documents created
 * @returns {Promise<void>} Resolves once done
 */
const recordDatasets = async (db, previous, version, owner) => {
  try {
    await createDatasets(db, addedDatasets(previous, version), { owner });
  } catch (err) {
    log.error({ err, project: version.shortname }, 'cannot create the dataset documents of a project save');
  }
};

/**
 * Store a new version of a project with NWL's saveProjectVersion (T002 2.1b;
 * the caller holds the project's lock, projectLock.js). `keepModified` is for
 * a change that is not a user's edit (scripts/migrate-projects.js): the
 * version keeps `doc`'s `modified` and `modifiedBy`.
 *
 * The datasets the version adds (http(s) sources the previous current
 * version does not list) get their document if they have none (T002 3.3,
 * datasets.js), owned by `datasetOwner`: the user saving, or for an admin
 * action the project's owner. A failure there is logged: the project is saved.
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {object} doc The project; an `_id` or `backup` in it is ignored
 * @param {object} options { by: the username stored as `modifiedBy`;
 *   keepModified: true to keep `doc`'s `modified` and `modifiedBy` instead;
 *   datasetOwner: the owner of the dataset documents it creates (default
 *   `by`, else the project's owner) }
 * @returns {Promise<object>} The document as stored, with its new `_id`
 */
const saveProjectVersion = (db, doc, { by, keepModified = false, datasetOwner }) => nwl.saveProjectVersion(db, doc, {
  by,
  keepModified,
  afterSave: ({ db: afterDb, previous, version }) => recordDatasets(afterDb, previous, version, datasetOwner || by || version.owner)
});

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
