/* eslint-disable max-lines */
/**
 * Admin tools for annotations whose project is missing (orphans).
 *
 * microdraw stores each region as its own document in the `annotations`
 * collection: { fileID: '<source>&slice=<slice>', user, project, Hash,
 * annotation }. A save marks the current documents of the image and project
 * as `backup: true` and inserts the new ones, so the current annotations are
 * the documents without `backup`.
 *
 * An orphan is a current (non-backup) document whose `project` is empty,
 * null or missing, or names a project that does not exist (no non-backup
 * document in `projects`). See docs/decisions.md D26.
 *
 * Nothing here deletes documents: removing marks them `backup: true`, as a
 * save does, and is logged with their ids in the `log` collection, so it can
 * be undone. Every action is logged, as in BrainBox.
 */
const monk = require('monk');

const isProjectName = (name) => typeof name === 'string' && name !== '';

const current = { backup: { $exists: false } };

/**
 * Shortnames of the projects that exist
 * @param {object} db Monk database
 * @returns {Promise<Array<string>>} Project shortnames
 */
const liveProjects = async (db) => {
  const shortnames = await db.get('projects').distinct('shortname', current);

  return shortnames.filter(isProjectName);
};

/**
 * Split a fileID into the image source and the slice
 * @param {string} fileID '<source>&slice=<slice>'
 * @returns {{source: string, slice: string}} The source and the slice
 */
const splitFileID = (fileID) => {
  if (typeof fileID !== 'string') {
    return { source: '', slice: '' };
  }
  const at = fileID.lastIndexOf('&slice=');
  if (at < 0) {
    return { source: fileID, slice: '' };
  }

  return { source: fileID.slice(0, at), slice: fileID.slice(at + '&slice='.length) };
};

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const dateOf = (id) => {
  try {
    return id.getTimestamp().toJSON();
  } catch (err) {
    return null;
  }
};

/**
 * Find the orphan annotations, grouped by image (fileID), author (user) and
 * the project value they carry ('' / null for none, or the name of a project
 * that does not exist), most recent first.
 * @param {object} db Monk database
 * @param {object} options { skip, limit, source }: paging, and an optional
 *   image source to restrict the search to
 * @returns {Promise<object>} { total, list: [{ fileID, source, slice, user,
 *   project, reason, regions, modified }] }; reason is 'none' (no project) or
 *   'missing' (the project does not exist)
 */
const findOrphanAnnotations = async (db, { skip = 0, limit = 50, source } = {}) => {
  const live = await liveProjects(db);
  // $nin also matches documents where project is null or missing
  const match = { ...current, project: { $nin: live } };
  if (typeof source === 'string' && source !== '') {
    match.fileID = new RegExp(`^${escapeRegExp(source)}&slice=`);
  }
  const [result] = await db.get('annotations').aggregate([
    { $match: match },
    {
      $group: {
        _id: { fileID: '$fileID', user: { $ifNull: ['$user', null] }, project: { $ifNull: ['$project', null] } },
        regions: { $sum: 1 },
        last: { $max: '$_id' }
      }
    },
    { $sort: { last: -1 } },
    {
      $facet: {
        total: [{ $count: 'n' }],
        list: [{ $skip: skip }, { $limit: limit }]
      }
    }
  ], { allowDiskUse: true });

  const total = (result && result.total.length) ? result.total[0].n : 0;
  const list = (result ? result.list : []).map((row) => ({
    fileID: row._id.fileID,
    ...splitFileID(row._id.fileID),
    user: row._id.user,
    project: row._id.project,
    reason: isProjectName(row._id.project) ? 'missing' : 'none',
    regions: row.regions,
    modified: dateOf(row.last)
  }));

  return { total, list };
};

/**
 * Check a request for an orphan group: { fileID, user, project }
 * @param {object} group The group sent by the client
 * @returns {string|null} What is wrong with it, null if nothing
 */
const groupError = (group) => {
  const { fileID, user, project } = group || {};
  if (typeof fileID !== 'string' || fileID === '') {
    return 'Provide the fileID of the group';
  }
  if (!(typeof user === 'string' || user === null)) {
    return 'Provide the user of the group (a string, or null)';
  }
  if (!(typeof project === 'string' || project === null)) {
    return 'Provide the project of the group (a string, or null for none)';
  }

  return null;
};

// The query for the current documents of an orphan group. null matches a
// null or a missing field, as in the $group of findOrphanAnnotations.
const groupQuery = ({ fileID, user, project }) => ({ fileID, user, project, ...current });

/**
 * The current documents of an orphan group, or the reason it is not one
 * @param {object} db Monk database
 * @param {object} group { fileID, user, project }
 * @returns {Promise<object>} { ids } or { status, error }
 */
const orphanGroupIds = async (db, group) => {
  if (isProjectName(group.project)) {
    const project = await db.get('projects').findOne({ shortname: group.project, ...current });
    if (project) {
      return { status: 409, error: `Project ${group.project} exists: these annotations are not orphans` };
    }
  }
  const docs = await db.get('annotations').find(groupQuery(group), { projection: { _id: 1 } });
  if (docs.length === 0) {
    return { status: 404, error: 'No orphan annotations for that image, user and project' };
  }

  return { ids: docs.map((d) => d._id) };
};

const log = (db, key, value) => {
  const { ids, ...rest } = value;
  console.log(`ADMIN ${key}`, JSON.stringify(ids ? { ...rest, documents: ids.length } : rest));

  return db.get('log').insert({ key, value, date: (new Date()).toJSON() });
};

/**
 * Remove an orphan group: mark its documents backup: true, as a save does.
 * Logged with the ids of the documents, so that restoreOrphans can undo it.
 * @param {object} db Monk database
 * @param {object} params { group: { fileID, user, project }, username }
 * @returns {Promise<object>} { removed, log } or { status, error }
 */
const removeOrphans = async (db, { group, username }) => {
  const found = await orphanGroupIds(db, group);
  if (found.error) {
    return found;
  }
  const { ids } = found;
  await db.get('annotations').update({ _id: { $in: ids }, ...current }, { $set: { backup: true } }, { multi: true });
  const entry = await log(db, 'adminRemoveOrphans', {
    username,
    fileID: group.fileID,
    user: group.user,
    project: group.project,
    ids: ids.map(String)
  });

  return { removed: ids.length, log: String(entry._id) };
};

const toId = (id) => {
  try {
    return monk.id(id);
  } catch (err) {
    return null;
  }
};

/**
 * Undo removeOrphans: the documents it marked as backup become current again.
 * Refused if the group has current documents again (a save since then).
 * @param {object} db Monk database
 * @param {object} params { logId, username }
 * @returns {Promise<object>} { restored } or { status, error }
 */
// eslint-disable-next-line max-statements
const restoreOrphans = async (db, { logId, username }) => {
  const id = toId(logId);
  const entry = id && await db.get('log').findOne({ _id: id, key: 'adminRemoveOrphans' });
  if (!entry) {
    return { status: 404, error: 'No orphan removal with that log id' };
  }
  const { fileID, user, project, ids } = entry.value;
  const now = await db.get('annotations').count(groupQuery({ fileID, user, project }));
  if (now > 0) {
    return { status: 409, error: 'These annotations have current documents again (restored already, or saved since)' };
  }
  const objectIds = ids.map(toId).filter(Boolean);
  const result = await db.get('annotations').update(
    { _id: { $in: objectIds }, backup: true },
    { $unset: { backup: '' } },
    { multi: true }
  );
  const restored = (result && (result.nModified || result.modifiedCount)) || 0;
  await log(db, 'adminRestoreOrphans', { username, removal: String(entry._id), fileID, user, project, restored });

  return { restored };
};

const fileName = (source) => {
  const at = source.lastIndexOf('/');

  return at >= 0 ? source.slice(at + 1) : source;
};

// Whether a project's file list has the image (items {source, name}, or plain
// strings in old projects)
const listsSource = (project, source) => {
  const list = (project && project.files && Array.isArray(project.files.list)) ? project.files.list : [];

  return list.some((f) => f === source || (f && f.source === source));
};

const listsSourceQuery = (source) => ({ $or: [{ 'files.list.source': source }, { 'files.list': source }] });

/**
 * Number of current annotations of a project on an image, in all and by a user
 * @param {object} db Monk database
 * @param {object} params { fileID, project, user }
 * @returns {Promise<object>} { existing, existingByUser }
 */
const existingAnnotations = async (db, { fileID, project, user }) => ({
  existing: await db.get('annotations').count({ fileID, project, ...current }),
  existingByUser: await db.get('annotations').count({ fileID, project, user, ...current })
});

/**
 * The projects an orphan group can be assigned to without changing their
 * file list: those that list its image
 * @param {object} db Monk database
 * @param {object} group { fileID, user }
 * @returns {Promise<Array<object>>} [{ shortname, name, owner, existing, existingByUser }]
 */
const candidateProjects = async (db, { fileID, user }) => {
  const { source } = splitFileID(fileID);
  const projects = await db.get('projects').find(
    { ...current, ...listsSourceQuery(source) },
    { projection: { _id: 0, shortname: 1, name: 1, owner: 1 }, sort: { shortname: 1 } }
  );
  const list = [];
  for (const p of projects.filter((q) => isProjectName(q.shortname))) {
    // eslint-disable-next-line no-await-in-loop
    list.push({ shortname: p.shortname, name: p.name || '', owner: p.owner || '', ...await existingAnnotations(db, { fileID, project: p.shortname, user }) });
  }

  return list;
};

/**
 * Assign an orphan group to a project: set `project` on its current
 * documents. Annotations the project already has on the image are kept: they
 * are separate documents, and the viewer shows both. With addImage, a project
 * that does not list the image gets it added to its file list first.
 *
 * There is no project lock yet (M3): a settings page saved at the same time
 * rewrites the whole project ($set) and can drop the image added here.
 * @param {object} db Monk database
 * @param {object} params { group, target, addImage, username }
 * @returns {Promise<object>} { assigned, addedImage, existing, existingByUser, log }
 *   or { status, error }
 */
// eslint-disable-next-line max-statements
const assignOrphans = async (db, { group, target, addImage, username }) => {
  const project = await db.get('projects').findOne({ shortname: target, ...current });
  if (!project) {
    return { status: 404, error: `Project ${target} not found` };
  }
  const found = await orphanGroupIds(db, group);
  if (found.error) {
    return found;
  }
  const { source } = splitFileID(group.fileID);
  let addedImage = false;
  if (!listsSource(project, source)) {
    if (!addImage) {
      return { status: 409, error: `Project ${target} does not list this image: add it to the project's files, or ask to add it` };
    }
    // Atomic on this document: only pushes if the image is still not listed.
    const result = await db.get('projects').update(
      { _id: project._id, 'files.list.source': { $ne: source }, 'files.list': { $ne: source } },
      { $push: { 'files.list': { name: fileName(source), source } } }
    );
    addedImage = Boolean(result && (result.nModified || result.modifiedCount));
  }
  const existing = await existingAnnotations(db, { fileID: group.fileID, project: target, user: group.user });
  const { ids } = found;
  await db.get('annotations').update({ _id: { $in: ids }, ...current }, { $set: { project: target } }, { multi: true });
  const entry = await log(db, 'adminAssignOrphans', {
    username,
    fileID: group.fileID,
    user: group.user,
    from: group.project,
    to: target,
    addedImage,
    ...existing,
    ids: ids.map(String)
  });

  return { assigned: ids.length, addedImage, ...existing, log: String(entry._id) };
};

module.exports = {
  splitFileID,
  groupError,
  findOrphanAnnotations,
  removeOrphans,
  restoreOrphans,
  candidateProjects,
  assignOrphans
};
