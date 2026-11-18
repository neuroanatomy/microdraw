/**
 * Validation and sanitising of the project documents sent to
 * POST /project/json/:projectName (M3, T002 step 1.4). Since M13b the checks
 * are NeuroWebLab's validateProject (1.20.0, project/validate.js), with
 * microdraw's rules (`rules` below).
 *
 * Follows BrainBox's isProjectObject (controller/project/project.controller.js),
 * adapted to microdraw (decisions D27):
 * - no `volume` annotation is required; annotation types are text|vectorial;
 * - files are {name, source} objects;
 * - a collaborator is named by `username` and/or `userID` (the 1.3.19 settings
 *   page writes both), equal; a save stores both on every row (T002 2.2); an
 *   `anyone` entry is required;
 * - access values are none|view|edit|add|remove;
 * - the users must exist: the owner of a new project, and the collaborators
 *   other than `anyone` that the stored project does not have yet;
 * - the owner is never taken from the client: the stored one is kept, a new
 *   project belongs to its creator;
 * - a new project's shortname has letters, numbers and hyphens only, as the
 *   new-project page asks (shared suite 2.6, 2026-11-11: hyphens allowed);
 * - every string is sanitised with DOMPurify: strings are plain text, so
 *   markup is removed and only the text is kept.
 *
 * plainText, sanitize, isBlank, text and listOf are NeuroWebLab's (1.10.0,
 * project/rules.js).
 */
const _ = require('lodash');
const { isBlank, listOf, plainText, sanitize, text, validateProject } = require('neuroweblab');

const annotationTypes = ['text', 'vectorial'];

const isNonEmptyString = (str) => typeof str === 'string' && str.trim() !== '';

/*
 * A collaborator row names its user by `username` (microdraw's key), `userID`
 * (BrainBox's key, written next to `username` by nwl-components when a user
 * is picked) or both, equal (T002 2.2). Every reader of a row's user goes
 * through collaboratorName; every save writes both keys (withBothKeys).
 */

// The name of a collaborator: username and/or userID (equal if both are set);
// undefined for a row that names nobody (or is not an object)
const collaboratorName = (c) => {
  if (!_.isPlainObject(c)) {
    return;
  }
  if (isNonEmptyString(c.username)) {
    return c.username;
  }
  if (isNonEmptyString(c.userID)) {
    return c.userID;
  }
};

// Whether a row has a username and a userID that differ
const hasDifferentKeys = (c) => _.isPlainObject(c) && isNonEmptyString(c.username) &&
  isNonEmptyString(c.userID) && c.username !== c.userID;

/**
 * A collaborator row with `username` and `userID` both set to its name (T002
 * 2.2, as BrainBox's rows carry `userID` and `nickname`). A row that names
 * nobody, or whose two keys differ, is returned as it is.
 * @param {object} c A collaborator row
 * @returns {object} The row with both keys
 */
const withBothKeys = (c) => {
  const name = collaboratorName(c);
  if (typeof name === 'undefined' || hasDifferentKeys(c)) {
    return c;
  }

  return { ...c, username: name, userID: name };
};

/**
 * Whether a file source is acceptable: a path, or an http(s) URL. Other
 * schemes (javascript:, data:, file:…) are refused.
 * @param {string} source The file source
 * @returns {boolean} True if valid
 */
const isValidSource = (source) => {
  // eslint-disable-next-line no-control-regex
  if (!isNonEmptyString(source) || (/[\u0000-\u001f\u007f\s]/).test(source)) {
    return false;
  }
  const scheme = source.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);

  return !scheme || ['http', 'https'].includes(scheme[1].toLowerCase());
};

const fileError = (file, i) => {
  if (!_.isPlainObject(file)) {
    return `File ${i + 1} must be an object {name, source}`;
  }
  if (!isValidSource(file.source)) {
    return `File ${i + 1} needs a source: a path or an http(s) URL`;
  }
  if (typeof file.name !== 'string') {
    return `File ${i + 1} needs a name`;
  }

  return null;
};

const annotationError = (a, i) => {
  if (!_.isPlainObject(a)) {
    return `Annotation ${i + 1} must be an object`;
  }
  if (!annotationTypes.includes(a.type)) {
    return `Annotation ${i + 1} has an invalid type (allowed: ${annotationTypes.join(', ')})`;
  }
  if (!isNonEmptyString(a.name)) {
    return `Annotation ${i + 1} needs a name`;
  }

  return null;
};

// What two layer names are compared on: case and surrounding spaces ignored
const nameKey = (name) => String(name).trim()
  .toLowerCase();

// A file as the nwl-components settings page sends it back: a file stored as
// a plain string s becomes {source: s, name: <text after the last '/'>}
// (ProjectService.transformProjectFiles)
const asFileObject = (f) => {
  if (typeof f !== 'string') {
    return f;
  }
  const at = f.lastIndexOf('/');

  return { source: f, name: at > 0 ? f.substring(at + 1) : '' };
};

// What a row is compared on, to tell whether it is stored unchanged: the
// fields the settings page shows (it adds a display name to collaborators),
// normalised as the page normalises them, on both sides. null, undefined and
// '' are the same value (text): the settings page may send back '' for a
// stored null.
const rowKey = {
  files: (f) => {
    const o = asFileObject(f);

    return _.isPlainObject(o) ? { source: text(o.source), name: text(o.name) } : o;
  },
  collaborators: (c) => {
    // a stored row with one key is the same row as it sent back with both
    const row = withBothKeys(c);

    return _.isPlainObject(row) ? { username: text(row.username), userID: text(row.userID), access: row.access } : row;
  },
  annotations: (a) => (_.isPlainObject(a) ? { type: a.type, name: text(a.name), values: text(a.values) } : a)
};

// Rows left empty (e.g. by the settings page's "+" button). Not NeuroWebLab's
// isBlankRow: a collaborator row is blank without reading `nickname`, so a row
// named by `nickname` alone is dropped, not refused.
const isBlankRow = {
  files: (f) => _.isPlainObject(f) && isBlank(f.source) && isBlank(f.name),
  collaborators: (c) => _.isPlainObject(c) && isBlank(c.username) && isBlank(c.userID),
  annotations: (a) => _.isPlainObject(a) && isBlank(a.name) && isBlank(a.values)
};

/**
 * Usernames among `names` that have no user document
 * @param {object} db Native MongoDB Db
 * @param {Array<string>} names Usernames
 * @returns {Promise<Array<string>>} The missing ones
 */
const missingUsers = async (db, names) => {
  const unique = _.uniq(names);
  const found = await db.collection('users').distinct('username', { username: { $in: unique } });

  return unique.filter((name) => !found.includes(name));
};

/**
 * microdraw's rules for NeuroWebLab's validateProject and projectRowProblems
 * (1.20.0), shared by checkProject and the stored-project check
 * (project.check.js), so that the two cannot drift apart. The stored fields
 * and the stored collaborator keys are checked: checkStoredFields and
 * checkStoredKeys keep NWL's defaults.
 */
const rules = {
  collaboratorUser: collaboratorName,
  fileError,
  layerError: annotationError,
  rowKey,
  isBlankRow,
  fieldsError: () => null,
  projectError: () => null
};

/**
 * Parse, sanitise and validate the project sent to POST /project/json/:projectName
 * (NeuroWebLab's validateProject with `rules`), then write both collaborator
 * keys on every row (T002 2.2)
 * @param {object} params { data: req.body.data, shortname: the name in the URL,
 *   oldProject: the stored project or undefined, owner: the owner to keep or set,
 *   db: native MongoDB Db (app.db.nativeMongoDB()) }
 * @returns {Promise<object>} { project, dropped: blank new rows removed, by
 *   list } or { error } (a 400 answer)
 */
const checkProject = async ({ data, shortname, oldProject, owner, db }) => {
  const { project, dropped, error } = await validateProject(data, {
    shortname,
    oldProject,
    owner,
    findMissingUsers: (names) => missingUsers(db, names),
    rules
  });
  if (error) {
    return { error };
  }
  // every row names its user by username and userID, equal (T002 2.2)
  project.collaborators.list = project.collaborators.list.map(withBothKeys);

  return { project, dropped };
};

module.exports = {
  annotationTypes,
  asFileObject,
  collaboratorName,
  checkProject,
  isBlank,
  listOf,
  nameKey,
  plainText,
  rules,
  sanitize,
  withBothKeys
};
