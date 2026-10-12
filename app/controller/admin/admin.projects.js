/**
 * Admin tools for the stored projects that don't validate (A2, decisions
 * D29). Named after BrainBox's controller/admin/admin.projects.js ("damaged
 * projects"), which finds a different kind of damage.
 *
 * The list is the check of scripts/check-projects.js (project.check.js). Two
 * fixes change a project:
 * - remove its blank rows (project.check.js isRemovableRow);
 * - give names to its unnamed annotation layers that have values.
 * Each one holds the project lock (M3b), refuses a project that changed since
 * it was listed (409: the client sends the version token of the list), logs
 * the previous document in `log`, and saves through the validation of normal
 * saves (checkProject, then NWL's upsertProject). Restore puts the logged
 * document back, if the project has not changed since the fix.
 *
 * Shortnames that are not alphanumeric and users that don't exist are listed
 * only: renaming a project would break its URLs and the annotations that name
 * it, and removing a collaborator could revoke someone's access.
 *
 * A3 (decisions D31, admin.projectActions.js) uses changeProject for the
 * transfer of a project's ownership, and restoreProject to undo it.
 */
const _ = require('lodash');
const monk = require('monk');
const { withProjectLock } = require('../projectLock');
const { checkProject, plainText } = require('../project/project.validation');
const {
  blankRows, checkStoredProjects, isUnnamedLayer, nameKey, projectVersion
} = require('../project/project.check');

const current = { backup: { $exists: false } };
const fixKeys = ['adminRemoveBlankRows', 'adminNameLayers', 'adminTransferOwner'];

const log = (db, key, value) => {
  console.log(`ADMIN ${key}`, JSON.stringify(_.omit(value, ['project'])));

  return db.get('log').insert({ key, value, date: (new Date()).toJSON() });
};

/**
 * The stored projects that have problems, as scripts/check-projects.js lists
 * them
 * @param {object} db Monk database
 * @returns {Promise<object>} { total, refused, list }
 */
const findInvalidProjects = (db) => checkStoredProjects(db);

// The default way changeProject stores a change: the validation of a
// settings save (rows stored unchanged are accepted), then NWL's upsertProject
const validatedSave = async (appDb, stored, data) => {
  const { project, error } = await checkProject({ data, shortname: stored.shortname, oldProject: stored, owner: stored.owner, db: appDb.mongoDB() });
  if (error) {
    return { status: 400, error: `The project would not validate after this change: ${error}` };
  }

  return { write: () => appDb.upsertProject(project) };
};

/**
 * Change a project holding its lock, if its version is still `version`:
 * `change` returns the new data (or { status, error }); `save` checks it and
 * returns how to write it (default: validated and stored as a settings save
 * is); the previous document is logged first.
 * @param {object} appDb NWL database (mongoDB(), upsertProject)
 * @param {object} params { shortname, version, username, key: log key,
 *   change: (stored copy) => { data, details } | { status, error },
 *   save: (appDb, stored, data) => Promise<{ write } | { status, error }> }
 * @returns {Promise<object>} { ...details, version, log } or { status, error }
 */
// eslint-disable-next-line max-statements
const changeProject = (appDb, { shortname, version, username, key, change, save = validatedSave }) => withProjectLock(shortname, async () => {
  const db = appDb.mongoDB();
  const stored = await db.get('projects').findOne({ shortname, ...current });
  if (!stored) {
    return { status: 404, error: `Project ${shortname} not found` };
  }
  if (projectVersion(stored) !== version) {
    return { status: 409, error: `Project ${shortname} has changed since it was listed: reload the list` };
  }
  const changed = change(_.cloneDeep(stored));
  if (changed.error) {
    return changed;
  }
  const saving = await save(appDb, stored, changed.data);
  if (saving.error) {
    return saving;
  }
  const entry = await log(db, key, { username, shortname, before: version, ...changed.details, project: _.omit(stored, ['_id']) });
  await saving.write();
  const after = projectVersion(await db.get('projects').findOne({ _id: stored._id }));
  await db.get('log').update({ _id: entry._id }, { $set: { 'value.after': after } });

  return { ...changed.details, version: after, log: String(entry._id) };
});

/**
 * Remove the blank rows of a project (project.check.js isRemovableRow)
 * @param {object} appDb NWL database
 * @param {object} params { shortname, version, username }
 * @returns {Promise<object>} { removed: counts by list, version, log } or { status, error }
 */
const removeBlankRows = (appDb, { shortname, version, username }) => changeProject(appDb, {
  shortname,
  version,
  username,
  key: 'adminRemoveBlankRows',
  change: (project) => {
    const blank = blankRows(project);
    const removed = _.mapValues(blank, (rows) => rows.length);
    if (_.sum(Object.values(removed)) === 0) {
      return { status: 409, error: `Project ${shortname} has no blank rows` };
    }
    for (const [type, rows] of Object.entries(blank)) {
      if (rows.length > 0) {
        project[type].list = project[type].list.filter((row, i) => !rows.includes(i));
      }
    }

    return { data: project, details: { removed } };
  }
});

/**
 * The names asked for, checked against a stored project: only unnamed
 * layers that have values; names non-empty once sanitised, unique in the
 * project (ignoring case and surrounding spaces)
 * @param {object} project The stored project
 * @param {object} names { index: name }
 * @returns {object} { names: Map index → name } or { status, error }
 */
// eslint-disable-next-line max-statements
const checkNames = (project, names) => {
  const layers = project.annotations.list;
  const chosen = new Map();
  for (const [key, value] of Object.entries(names)) {
    const index = Number(key);
    if (!Number.isInteger(index) || !isUnnamedLayer(layers[index])) {
      return { status: 400, error: `Layer ${key} is not an unnamed layer with values` };
    }
    const name = typeof value === 'string' ? plainText(value).trim() : '';
    if (name === '') {
      return { status: 400, error: `Layer ${index + 1} needs a name` };
    }
    chosen.set(index, name);
  }
  const all = layers.map((a, i) => (chosen.has(i) ? chosen.get(i) : (a && a.name))).filter((name) => typeof name === 'string' && name.trim() !== '');
  const seen = new Set();
  for (const name of all) {
    if (seen.has(nameKey(name))) {
      return { status: 400, error: `Two layers would be called "${name}"` };
    }
    seen.add(nameKey(name));
  }

  return { names: chosen };
};

/**
 * Give names to the unnamed layers of a project
 * @param {object} appDb NWL database
 * @param {object} params { shortname, version, names: { index: name }, username }
 * @returns {Promise<object>} { named, version, log } or { status, error }
 */
const nameLayers = (appDb, { shortname, version, names, username }) => changeProject(appDb, {
  shortname,
  version,
  username,
  key: 'adminNameLayers',
  change: (project) => {
    if (!_.isPlainObject(project.annotations) || !Array.isArray(project.annotations.list)) {
      return { status: 400, error: `Project ${shortname} has no annotation layers` };
    }
    const checked = checkNames(project, names);
    if (checked.error) {
      return checked;
    }
    for (const [index, name] of checked.names) {
      project.annotations.list[index].name = name;
    }

    return { data: project, details: { named: checked.names.size, names: Object.fromEntries(checked.names) } };
  }
});

const toId = (id) => {
  try {
    return monk.id(id);
  } catch (err) {
    return null;
  }
};

/**
 * Put back the project document logged by a fix, if the project has not
 * changed since the fix. Written as it was logged, without the validation
 * of saves: it was the stored version, and stored rows are accepted.
 * @param {object} appDb NWL database
 * @param {object} params { logId, username }
 * @returns {Promise<object>} { version } or { status, error }
 */
const restoreProject = async (appDb, { logId, username }) => {
  const db = appDb.mongoDB();
  const id = typeof logId === 'string' && (/^[0-9a-f]{24}$/).test(logId) ? toId(logId) : null;
  const entry = id && await db.get('log').findOne({ _id: id, key: { $in: fixKeys } });
  if (!entry) {
    return { status: 404, error: 'No project fix with that log id' };
  }
  const { shortname, after, project: previous } = entry.value;

  return withProjectLock(shortname, async () => {
    const stored = await db.get('projects').findOne({ shortname, ...current });
    if (!stored || typeof after !== 'string' || projectVersion(stored) !== after) {
      return { status: 409, error: `Project ${shortname} has changed since this fix (restored already, or edited): not restored` };
    }
    const extra = Object.keys(stored).filter((k) => k !== '_id' && !(k in previous));
    const update = { $set: previous, ...(extra.length > 0 ? { $unset: _.fromPairs(extra.map((k) => [k, ''])) } : {}) };
    await log(db, 'adminRestoreProject', { username, shortname, restored: String(entry._id), project: _.omit(stored, ['_id']) });
    await db.get('projects').update({ _id: stored._id }, update);

    return { version: projectVersion(await db.get('projects').findOne({ _id: stored._id })) };
  });
};

module.exports = {
  changeProject,
  findInvalidProjects,
  removeBlankRows,
  nameLayers,
  restoreProject
};
