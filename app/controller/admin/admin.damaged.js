/**
 * Admin tools for damaged projects (T002 3.6, part A): files removed by a
 * save that are still missing from the current version, and projects with
 * several current versions.
 *
 * The analysis and the two fixes are NeuroWebLab's `damagedProjects` (1.23.0,
 * `admin/damaged.js`, stage 4 merge M16, written from this file): the version
 * token (projectVersion), the removal events, the rows put back with their
 * names, the log entries with the previous document and the `after` token.
 * What stays microdraw's is given by the adapter below:
 * - the file rows of a version (`fileRows`: `{source, name}`, old plain
 *   strings as rows);
 * - the annotated files (the `annotations`' fileIDs of the project);
 * - the save (its saveProjectVersion, whose datasets go to the project's owner);
 * - the lock (the project's, as projectLock.js);
 * - the pino line of adminLog, without the previous document.
 *
 * Exports `{ findDamagedProjects(db), restoreFiles(db, params),
 * fixCurrentVersions(db, params), isIncompleteSave }`, `db` the native
 * MongoDB Db.
 */
const _ = require('lodash');
const logger = require('../../log');
const { damagedProjects, projectKey } = require('neuroweblab');
const { fileRows } = require('../datasets');
const { CURRENT, saveProjectVersion } = require('../project/currentProject');
const { splitFileID } = require('./admin.annotations');

/**
 * The sources among `files` that have current annotations in the project
 * @param {object} db Native MongoDB Db
 * @param {string} shortname Project shortname
 * @param {Array<string>} files Sources
 * @returns {Promise<Set<string>>} The sources with annotations
 */
const annotatedFiles = async (db, shortname, files) => {
  const fileIDs = await db.collection('annotations').distinct('fileID', { project: shortname, ...CURRENT });
  const wanted = new Set(files);

  return new Set(fileIDs.map((f) => splitFileID(f).source).filter((s) => wanted.has(s)));
};

module.exports = damagedProjects({
  sourcesOf: fileRows,
  annotatedFiles,
  save: (db, doc, { by, previous }) => saveProjectVersion(db, doc, { by, datasetOwner: previous.owner }),
  lockKeys: (shortname) => [projectKey(shortname)],
  logger,
  logFields: (value) => _.omit(value, ['project'])
});
