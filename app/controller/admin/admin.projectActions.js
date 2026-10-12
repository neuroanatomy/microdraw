/**
 * Admin actions on any project (A3, decisions D31), found by a search by
 * shortname or name:
 * - delete, as its owner would (project.delete.js: the annotations are marked
 *   as backups, the project is logged), and restore a deleted project with
 *   exactly the annotations its delete marked;
 * - transfer the ownership to an existing user (changeProject of A2, undone
 *   by A2's restoreProject).
 * Each holds the project lock and refuses a project changed since it was
 * found (409, the version token of A2).
 */
const _ = require('lodash');
const { withProjectLock } = require('../projectLock');
const { listOf } = require('../project/project.validation');
const { projectVersion } = require('../project/project.check');
const { deleteStoredProject, findDeleteEntry, restoreDeletedProject } = require('../project/project.delete');
const { escapeRegex } = require('../search/search.controller');
const { changeProject } = require('./admin.projects');

const current = { backup: { $exists: false } };

const maxFound = 20;

/**
 * Find projects by shortname or name (A3): the text matches literally
 * (escaped), ignoring case. Read-only.
 * @param {object} db Monk database
 * @param {string} q The text to search for
 * @returns {Promise<object>} { list: [{ shortname, name, owner, ownerExists,
 *   version, counts: { files, collaborators, layers, annotations } }], more:
 *   whether there were more than the ones listed }
 */
const searchProjects = async (db, q) => {
  const text = { $regex: escapeRegex(q), $options: 'i' };
  const found = await db.get('projects').find({ ...current, $or: [{ shortname: text }, { name: text }] }, { sort: { shortname: 1 }, limit: maxFound + 1 });
  const projects = found.slice(0, maxFound);
  const owners = _.uniq(projects.map((p) => p.owner).filter((o) => typeof o === 'string'));
  const users = new Set(await db.get('users').distinct('username', { username: { $in: owners } }));
  const counted = await db.get('annotations').aggregate([
    { $match: { ...current, project: { $in: projects.map((p) => p.shortname) } } },
    { $group: { _id: '$project', n: { $sum: 1 } } }
  ]);
  const annotations = new Map(counted.map((c) => [c._id, c.n]));
  const list = projects.map((p) => ({
    shortname: p.shortname,
    name: typeof p.name === 'string' ? p.name : '',
    owner: p.owner,
    ownerExists: users.has(p.owner),
    version: projectVersion(p),
    counts: {
      files: listOf(p, 'files').length,
      collaborators: listOf(p, 'collaborators').length,
      layers: listOf(p, 'annotations').length,
      annotations: annotations.get(p.shortname) || 0
    }
  }));

  return { list, more: found.length > maxFound };
};

/**
 * Delete a project as its owner would (project.delete.js: annotations marked
 * as backups, project logged), if its version is still `version`
 * @param {object} appDb NWL database
 * @param {object} params { shortname, version, username }
 * @returns {Promise<object>} { log, annotations } or { status, error }
 */
const deleteProject = (appDb, { shortname, version, username }) => withProjectLock(shortname, async () => {
  const stored = await appDb.mongoDB().get('projects')
    .findOne({ shortname, ...current });
  if (!stored) {
    return { status: 404, error: `Project ${shortname} not found` };
  }
  if (projectVersion(stored) !== version) {
    return { status: 409, error: `Project ${shortname} has changed since it was listed: reload the list` };
  }

  return deleteStoredProject(appDb, { project: stored, username, key: 'adminDeleteProject' });
});

/**
 * Undo a delete (an admin's or an owner's): the project document and the
 * annotations that delete marked come back
 * @param {object} appDb NWL database
 * @param {object} params { logId: the id returned by the delete, username }
 * @returns {Promise<object>} { shortname, annotations, version } or { status, error }
 */
const restoreDeleted = async (appDb, { logId, username }) => {
  const db = appDb.mongoDB();
  const entry = await findDeleteEntry(db, logId);
  if (!entry) {
    return { status: 404, error: 'No project delete with that log id' };
  }
  const { shortname } = entry.value;

  return withProjectLock(shortname, async () => {
    const restored = await restoreDeletedProject(db, { entry, username });
    if (restored.error) {
      return restored;
    }

    return { shortname, annotations: restored.annotations, version: projectVersion(restored.project) };
  });
};

/**
 * Give a project to another user, who must exist. Only `owner` changes: the
 * document is not run through the save validation, so that a project that
 * would not validate can be handed to someone who can fix it. The new owner
 * has every right through NWL's IsOwner; the collaborators are unchanged.
 * Undone by restoreProject.
 * @param {object} appDb NWL database
 * @param {object} params { shortname, version, owner: the new owner, username }
 * @returns {Promise<object>} { owner, previousOwner, version, log } or { status, error }
 */
const transferProject = async (appDb, { shortname, version, owner, username }) => {
  const exists = await appDb.mongoDB().get('users')
    .findOne({ username: owner });
  if (!exists) {
    return { status: 400, error: `User ${owner} does not exist` };
  }

  return changeProject(appDb, {
    shortname,
    version,
    username,
    key: 'adminTransferOwner',
    change: (project) => {
      if (project.owner === owner) {
        return { status: 400, error: `${owner} owns ${shortname} already` };
      }

      return { data: { ...project, owner }, details: { from: project.owner, to: owner } };
    },
    save: (db, stored) => Promise.resolve({ write: () => db.mongoDB().get('projects')
      .update({ _id: stored._id }, { $set: { owner } }) })
  }).then(({ from, to, ...result }) => (result.error ? result : { ...result, owner: to, previousOwner: from }));
};

module.exports = {
  searchProjects,
  deleteProject,
  restoreDeleted,
  transferProject
};
