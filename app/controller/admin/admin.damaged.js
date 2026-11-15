/* eslint-disable max-lines -- the list and its two fixes, as BrainBox's admin.projects.js; 2026-11-15 */
/**
 * Admin tools for damaged projects (T002 3.6, part A), as BrainBox's
 * controller/admin/admin.projects.js (getDamagedProjects, restoreFiles,
 * fixCurrentVersions).
 *
 * A project's versions are documents with the same shortname; the current
 * one has no `backup` field (T002 2.1). A project is damaged when:
 * - files removed by a save are still missing from the current version. The
 *   settings page used to save before every batch of 100 files had arrived
 *   (fixed by 3.1): a save that kept the first files of the previous version,
 *   a multiple of 100 of them (maybe none), is flagged as an incomplete save.
 *   Other removals are listed too, as they may have been deliberate;
 * - it has several current versions (a race between two saves).
 *
 * Files are `{name, source}` rows (decision 2.3, option C), or plain strings
 * in old versions: they are compared by source, and a restored row keeps the
 * name it had in the version before the save that removed it.
 *
 * The fixes hold the project lock, refuse a project changed since the list
 * was read (the version token of A2, project.check.js projectVersion), and
 * are logged in `log`:
 * - restore-files stores a new version (saveProjectVersion) with the missing
 *   rows added at the end of the list; the entry has the previous document
 *   and the `after` token, as A2's fixes, so A2's restore undoes it;
 * - fix-current marks the older current versions `backup`; the entry lists
 *   their ids (unset `backup` on them to undo it).
 */
const _ = require('lodash');
const logger = require('../../log');
const { withProjectLock } = require('../projectLock');
const { toId } = require('../toId');
const { fileRows } = require('../datasets');
const { projectVersion } = require('../project/project.check');
const { CURRENT: current, findCurrentProject, saveProjectVersion } = require('../project/currentProject');
const { splitFileID } = require('./admin.annotations');

const BATCH_LENGTH = 100; // files per batch in the settings page
const EXAMPLES = 3; // missing files shown for each save

const isProjectName = (name) => typeof name === 'string' && name !== '';

const sources = (version) => fileRows(version).map((r) => r.source)
  .filter((s) => typeof s === 'string');

const dateOf = (version) => {
  if (typeof version.modified === 'string') {
    return version.modified;
  }
  try {
    return version._id.getTimestamp().toJSON();
  } catch (err) {
    return null;
  }
};

/**
 * The versions of a project, oldest first, with what is needed to compare
 * their files
 * @param {object} db Native MongoDB Db
 * @param {string} shortname Project shortname
 * @returns {Promise<Array<object>>} The versions
 */
const projectVersions = (db, shortname) => db.collection('projects')
  .find({ shortname }, { projection: { files: 1, modified: 1, modifiedBy: 1, backup: 1 }, sort: { _id: 1 } })
  .toArray();

/**
 * Whether a save looks like it sent an incomplete list of files: it keeps the
 * first files of the previous version, a multiple of BATCH_LENGTH of them
 * @param {Array<string>} before Sources of the previous version
 * @param {Array<string>} after Sources of the version saved
 * @returns {boolean} True for an incomplete save
 */
const isIncompleteSave = (before, after) => after.length < before.length &&
  after.length % BATCH_LENGTH === 0 &&
  after.every((s, i) => s === before[i]);

/**
 * The sources of a version that the next one does not have, in order
 * @param {Array<string>} before Sources of the version
 * @param {Array<string>} after Sources of the next version
 * @returns {Array<string>} The sources removed
 */
const removedFiles = (before, after) => {
  const kept = new Set(after);

  return [...new Set(before)].filter((s) => !kept.has(s));
};

/**
 * The sources among `files` that have current annotations in the project
 * @param {object} db Native MongoDB Db
 * @param {string} shortname Project shortname
 * @param {Array<string>} files Sources
 * @returns {Promise<Set<string>>} The sources with annotations
 */
const annotatedFiles = async (db, shortname, files) => {
  if (files.length === 0) {
    return new Set();
  }
  const fileIDs = await db.collection('annotations').distinct('fileID', { project: shortname, ...current });
  const wanted = new Set(files);

  return new Set(fileIDs.map((f) => splitFileID(f).source).filter((s) => wanted.has(s)));
};

/**
 * The saves of a project that removed files still missing from its current
 * version (`now`)
 * @param {Array<object>} versions The versions, oldest first
 * @param {Set<string>} now The sources of the current version
 * @returns {Array<object>} One event per save
 */
const removalEvents = (versions, now) => {
  const events = [];
  for (let i = 1; i < versions.length; i++) {
    const before = sources(versions[i - 1]);
    const after = sources(versions[i]);
    const removed = removedFiles(before, after);
    const stillMissing = removed.filter((s) => !now.has(s));
    if (stillMissing.length > 0) {
      events.push({
        save: String(versions[i]._id),
        previous: String(versions[i - 1]._id),
        modified: dateOf(versions[i]),
        modifiedBy: versions[i].modifiedBy || null,
        before: before.length,
        after: after.length,
        removed: removed.length,
        stillMissing,
        incomplete: isIncompleteSave(before, after)
      });
    }
  }

  return events;
};

/**
 * Examine a project's versions. Read-only.
 * @param {object} db Native MongoDB Db
 * @param {string} shortname Project shortname
 * @returns {Promise<object|null>} The damage found, or null if there is none
 */
// eslint-disable-next-line max-statements
const examineProject = async (db, shortname) => {
  const versions = await projectVersions(db, shortname);
  const currents = versions.filter((v) => !v.backup);
  if (currents.length === 0) {
    return null; // a deleted project
  }
  const latest = currents[currents.length - 1];
  const events = removalEvents(versions, new Set(sources(latest)));
  if (events.length === 0 && currents.length === 1) {
    return null;
  }
  const missing = [...new Set(events.flatMap((e) => e.stillMissing))];
  const annotated = await annotatedFiles(db, shortname, missing);
  const project = await findCurrentProject(db, shortname);

  return {
    shortname,
    name: typeof project.name === 'string' ? project.name : '',
    owner: project.owner,
    version: projectVersion(project),
    files: sources(latest).length,
    versions: versions.length,
    currentVersions: currents.map((v) => ({ id: String(v._id), modified: dateOf(v), modifiedBy: v.modifiedBy || null })),
    missing: missing.length,
    suspected: events.some((e) => e.incomplete),
    events: events.map(({ stillMissing, ...e }) => ({
      ...e,
      stillMissing: stillMissing.length,
      annotated: stillMissing.filter((s) => annotated.has(s)).length,
      examples: stillMissing.slice(0, EXAMPLES)
    }))
  };
};

/**
 * Find the damaged projects. Projects with an incomplete save come first,
 * then those with the most files missing. Read-only.
 * @param {object} db Native MongoDB Db
 * @returns {Promise<object>} { list: [{ shortname, name, owner, version,
 *   files, versions, currentVersions: [{ id, modified, modifiedBy }], missing,
 *   suspected, events: [{ save, previous, modified, modifiedBy, before, after,
 *   removed, stillMissing, annotated, incomplete, examples }] }] }, where an
 *   event is a save (`save`, the _id of the version it stored) that removed
 *   files still missing
 */
const findDamagedProjects = async (db) => {
  const shortnames = (await db.collection('projects').distinct('shortname')).filter(isProjectName);
  const list = [];
  for (const shortname of shortnames) {
    // one project at a time, to keep the memory used bounded
    // eslint-disable-next-line no-await-in-loop
    const damage = await examineProject(db, shortname);
    if (damage) {
      list.push(damage);
    }
  }
  list.sort((a, b) => (Number(b.suspected) - Number(a.suspected)) || (b.missing - a.missing) || a.shortname.localeCompare(b.shortname));

  return { list };
};

const log = async (db, key, value) => {
  logger.info({ event: key, ..._.omit(value, ['project']) }, `admin: ${key}`);
  const entry = { key, value, date: (new Date()).toJSON() };
  await db.collection('log').insertOne(entry); // sets entry._id

  return entry;
};

/**
 * The rows to add back for a save: those of the version before it whose
 * source the save removed and the current version does not have, one per
 * source, with the name they had
 * @param {Array<object>} versions The versions, oldest first
 * @param {object} id ObjectId of the version the save stored
 * @param {object} stored The current version
 * @returns {object} { rows } or { status, error }
 */
const rowsToRestore = (versions, id, stored) => {
  const index = versions.findIndex((v) => v._id.equals(id));
  if (index < 1) {
    return { status: 404, error: 'No save of this project stored that version' };
  }
  const removed = new Set(removedFiles(sources(versions[index - 1]), sources(versions[index])));
  const now = new Set(sources(stored));
  const rows = _.uniqBy(fileRows(versions[index - 1]).filter((r) => removed.has(r.source) && !now.has(r.source)), 'source');
  if (rows.length === 0) {
    return { status: 409, error: 'The files that save removed are all in the project' };
  }

  return { rows };
};

/**
 * Add back to a project the files that a save removed and that are still
 * missing, after its current files, as a new version. Refused while the
 * project has several current versions (fix-current first).
 * @param {object} appDb NWL database (nativeMongoDB())
 * @param {object} params { shortname, version: token of the list, save: _id
 *   of the version the save stored, username }
 * @returns {Promise<object>} { restored, files, version, log } or { status, error }
 */
// eslint-disable-next-line max-statements
const restoreFiles = (appDb, { shortname, version, save, username }) => withProjectLock(shortname, async () => {
  const db = appDb.nativeMongoDB();
  const id = toId(save);
  if (!id) {
    return { status: 400, error: 'Provide the save: the id of the version it stored, as listed' };
  }
  const versions = await projectVersions(db, shortname);
  const currents = versions.filter((v) => !v.backup);
  if (currents.length === 0) {
    return { status: 404, error: `Project ${shortname} not found` };
  }
  if (currents.length > 1) {
    return { status: 409, error: `Project ${shortname} has ${currents.length} current versions: fix that first` };
  }
  const stored = await findCurrentProject(db, shortname);
  if (projectVersion(stored) !== version) {
    return { status: 409, error: `Project ${shortname} has changed since it was listed: reload the list` };
  }
  const plan = rowsToRestore(versions, id, stored);
  if (plan.error) {
    return plan;
  }
  const files = { ...(_.isPlainObject(stored.files) ? stored.files : {}), list: [...(stored.files && Array.isArray(stored.files.list) ? stored.files.list : []), ...plan.rows] };
  const entry = await log(db, 'adminRestoreProjectFiles', {
    username, shortname, before: version, save, files: plan.rows.map((r) => r.source), project: _.omit(stored, ['_id'])
  });
  await saveProjectVersion(db, { ...stored, files }, { by: username, datasetOwner: stored.owner });
  const after = projectVersion(await findCurrentProject(db, shortname));
  await db.collection('log').updateOne({ _id: entry._id }, { $set: { 'value.after': after } });

  return { restored: plan.rows.length, files: files.list.length, version: after, log: String(entry._id) };
});

/**
 * Keep the newest of several current versions of a project, and mark the
 * others `backup`
 * @param {object} appDb NWL database (nativeMongoDB())
 * @param {object} params { shortname, version: token of the list (of the
 *   newest current version), username }
 * @returns {Promise<object>} { kept, backups, version, log } or { status, error }
 */
// eslint-disable-next-line max-statements
const fixCurrentVersions = (appDb, { shortname, version, username }) => withProjectLock(shortname, async () => {
  const db = appDb.nativeMongoDB();
  const currents = await db.collection('projects')
    .find({ shortname, ...current }, { sort: { _id: 1 } })
    .toArray();
  if (currents.length === 0) {
    return { status: 404, error: `Project ${shortname} not found` };
  }
  const kept = currents.pop();
  if (projectVersion(kept) !== version) {
    return { status: 409, error: `Project ${shortname} has changed since it was listed: reload the list` };
  }
  if (currents.length === 0) {
    return { status: 409, error: `Project ${shortname} does not have several current versions` };
  }
  const backups = currents.map((v) => v._id);
  await db.collection('projects').updateMany({ _id: { $in: backups }, ...current }, { $set: { backup: true } });
  const entry = await log(db, 'adminFixCurrentVersions', {
    username, shortname, kept: String(kept._id), backups: backups.map(String)
  });

  return { kept: String(kept._id), backups: backups.length, version, log: String(entry._id) };
});

module.exports = {
  isIncompleteSave,
  findDamagedProjects,
  restoreFiles,
  fixCurrentVersions
};
