/**
 * Deleting a project, and undoing it (decisions D28, D31). Shared by the
 * owner's delete (DELETE /project/json/:projectName, M3b) and the admin
 * delete (POST /admin/json/projects/delete, A3), so that the two have the
 * same effect.
 *
 * A delete never removes annotations: the project's current annotation
 * documents get `{backup: true, deletedWithProject: '<log id>'}`, after the
 * project document has been written to the `log` collection. Restore puts the
 * logged document back (with its original _id) and removes exactly that mark.
 */
const _ = require('lodash');
const logger = require('../../log');
const { toId } = require('../toId');

const deleteKeys = ['deleteProject', 'adminDeleteProject'];
const current = { backup: { $exists: false } };

/**
 * Delete a stored project: log it, mark its current annotations as backups,
 * remove the project. The caller holds the project lock and has checked the
 * right to delete.
 * @param {object} appDb NWL database (nativeMongoDB(), deleteProject)
 * @param {object} params { project: the stored document, username: who
 *   deletes, key: the log key ('deleteProject' or 'adminDeleteProject') }
 * @returns {Promise<object>} { log: the log id, annotations: how many were marked }
 */
const deleteStoredProject = async (appDb, { project, username, key = 'deleteProject' }) => {
  const db = appDb.nativeMongoDB();
  const { shortname } = project;
  const annotations = { project: shortname, ...current };
  const entry = {
    key,
    value: {
      username,
      shortname,
      projectId: project._id,
      project: _.omit(project, ['_id']),
      annotations: await db.collection('annotations').countDocuments(annotations)
    },
    date: (new Date()).toJSON()
  };
  await db.collection('log').insertOne(entry); // sets entry._id
  const log = String(entry._id);
  await db.collection('annotations').updateMany(annotations, { $set: { backup: true, deletedWithProject: log } });
  await appDb.deleteProject({ shortname });
  logger.info({ event: key, shortname, by: username, log }, 'project deleted');

  return { log, annotations: entry.value.annotations };
};

/**
 * The log entry of a delete, from its id
 * @param {object} db Native database (nativeMongoDB())
 * @param {string} logId The id returned by the delete
 * @returns {Promise<object|null>} The entry, null if there is none
 */
const findDeleteEntry = (db, logId) => {
  // lowercase only: a log id in capitals is not found (404)
  const id = typeof logId === 'string' && (/^[0-9a-f]{24}$/).test(logId) ? toId(logId) : null;

  return id ? db.collection('log').findOne({ _id: id, key: { $in: deleteKeys } }) : Promise.resolve(null);
};

/**
 * Undo a delete: insert the logged project document again (its original
 * _id, when the log has it), and make current again the annotations that this
 * delete marked (older backups stay backups). Refused (409) if a project with
 * that shortname exists again, or if the delete was restored already. The
 * caller holds the project lock (withProjectLock on value.shortname).
 * @param {object} db Native database (nativeMongoDB())
 * @param {object} params { entry: the delete's log entry, username: who restores }
 * @returns {Promise<object>} { annotations: how many were restored, project:
 *   the document as stored again } or { status, error }
 */
// eslint-disable-next-line max-statements
const restoreDeletedProject = async (db, { entry, username }) => {
  const { shortname, project, projectId } = entry.value;
  const log = String(entry._id);
  if (entry.value.restored) {
    return { status: 409, error: `Project ${shortname} was restored already` };
  }
  if (await db.collection('projects').findOne({ shortname, ...current })) {
    return { status: 409, error: `A project ${shortname} exists again: not restored` };
  }
  const marked = { deletedWithProject: log };
  const restore = {
    key: 'adminRestoreDeletedProject',
    value: { username, shortname, restored: log, annotations: await db.collection('annotations').countDocuments(marked) },
    date: (new Date()).toJSON()
  };
  await db.collection('log').insertOne(restore); // sets restore._id
  // projectId was read natively from the log: the project keeps its ObjectId
  const doc = projectId ? { _id: projectId, ...project } : { ...project };
  await db.collection('projects').insertOne(doc); // sets doc._id when the log has no projectId
  await db.collection('annotations').updateMany(marked, { $unset: { backup: '', deletedWithProject: '' } });
  await db.collection('log').updateOne({ _id: entry._id }, { $set: { 'value.restored': String(restore._id) } });
  logger.info({ event: 'restoreDeletedProject', shortname, by: username, log }, 'project restored');

  return { annotations: restore.value.annotations, project: await db.collection('projects').findOne({ _id: doc._id }) };
};

module.exports = {
  deleteKeys,
  deleteStoredProject,
  findDeleteEntry,
  restoreDeletedProject
};
