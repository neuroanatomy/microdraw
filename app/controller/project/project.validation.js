/**
 * Validation and sanitising of the project documents sent to
 * POST /project/json/:projectName (M3, T002 step 1.4).
 *
 * Follows BrainBox's isProjectObject (controller/project/project.controller.js),
 * adapted to microdraw (decisions D27):
 * - no `volume` annotation is required; annotation types are text|vectorial;
 * - files are {name, source} objects;
 * - a collaborator is named by `username` and/or `userID` (the 1.3.19 settings
 *   page writes both); an `anyone` entry is required;
 * - access values are none|view|edit|add|remove;
 * - the users must exist: the owner of a new project, and the collaborators
 *   other than `anyone` that the stored project does not have yet;
 * - the owner is never taken from the client: the stored one is kept, a new
 *   project belongs to its creator;
 * - a new project's shortname is alphanumeric, as the new-project page asks;
 * - every string is sanitised with DOMPurify: strings are plain text, so
 *   markup is removed and only the text is kept.
 */
const _ = require('lodash');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const { AccessLevel } = require('neuroweblab');

const { window } = new JSDOM('', {
  features: {
    FetchExternalResources: false, // disables resource loading over HTTP / filesystem
    ProcessExternalResources: false // do not execute JS within script blocks
  }
});
const DOMPurify = createDOMPurify(window);

const annotationTypes = ['text', 'vectorial'];
const listTypes = ['files', 'collaborators', 'annotations'];
const shortnamePattern = /^[a-zA-Z0-9]+$/;
// Fields the client may not set: the database id, and the backup flag (a
// project with `backup` is hidden from every read).
const serverFields = ['_id', 'backup'];

/**
 * Plain text of a string: markup removed by DOMPurify, text kept. A string
 * without "<" cannot hold markup and is kept as it is (DOMPurify would
 * otherwise turn "&" into "&amp;" in URLs).
 * @param {string} str A string
 * @returns {string} The string without markup
 */
const plainText = (str) => {
  if (!str.includes('<')) {
    return str;
  }

  return DOMPurify.sanitize(str, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true }).textContent;
};

/**
 * A copy of a JSON value with every string sanitised (plainText)
 * @param {*} value A value parsed from JSON
 * @returns {*} The sanitised copy
 */
const sanitize = (value) => {
  if (typeof value === 'string') {
    return plainText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (_.isPlainObject(value)) {
    return _.mapValues(value, sanitize);
  }

  return value;
};

/**
 * The project sent in the body (data, as an object or a JSON string)
 * @param {*} data req.body.data
 * @returns {object|undefined} The project, or undefined if it is not an object
 */
const parseProjectData = (data) => {
  let project = data;
  if (typeof data === 'string') {
    try {
      project = JSON.parse(data);
    } catch (err) {
      return;
    }
  }
  if (_.isPlainObject(project)) {
    return project;
  }
};

const isNonEmptyString = (str) => typeof str === 'string' && str.trim() !== '';

// The name of a collaborator: username and/or userID (equal if both are set)
const collaboratorName = (c) => (isNonEmptyString(c.username) ? c.username : c.userID);

const isAnyone = (c) => c.username === 'anyone' || c.userID === 'anyone';

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

// eslint-disable-next-line max-statements
const collaboratorError = (c, i) => {
  if (!_.isPlainObject(c)) {
    return `Collaborator ${i + 1} must be an object`;
  }
  const hasUsername = isNonEmptyString(c.username);
  const hasUserID = isNonEmptyString(c.userID);
  if (!hasUsername && !hasUserID) {
    return `Collaborator ${i + 1} needs a username`;
  }
  if (hasUsername && hasUserID && c.username !== c.userID) {
    return `Collaborator ${i + 1} has a different username and userID`;
  }
  if (!_.isPlainObject(c.access) || !listTypes.every((type) => AccessLevel.values.includes(c.access[type]))) {
    return `Collaborator ${collaboratorName(c)} has invalid access values (allowed: ${AccessLevel.values.join(', ')})`;
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
  if (typeof a.name !== 'string') {
    return `Annotation ${i + 1} needs a name`;
  }

  return null;
};

const firstError = (list, check) => {
  for (let i = 0; i < list.length; i += 1) {
    const error = check(list[i], i);
    if (error) {
      return error;
    }
  }

  return null;
};

/**
 * Synchronous checks of a sanitised project
 * @param {object} project The project
 * @param {object} params { shortname: the name in the URL, isNew }
 * @returns {string|null} What is wrong, or null
 */
// eslint-disable-next-line max-statements, complexity
const structureError = (project, { shortname, isNew }) => {
  if (project.shortname !== shortname) {
    return 'The project shortname in the data differs from the one in the URL';
  }
  if (isNew && !shortnamePattern.test(shortname)) {
    return 'The project shortname can only contain letters and numbers';
  }
  for (const field of ['name', 'description', 'url']) {
    if (typeof project[field] !== 'undefined' && typeof project[field] !== 'string') {
      return `The project ${field} must be a string`;
    }
  }
  for (const type of listTypes) {
    if (!_.isPlainObject(project[type]) || !Array.isArray(project[type].list)) {
      return `The project needs a ${type} list`;
    }
  }

  const error = firstError(project.files.list, fileError) ||
    firstError(project.collaborators.list, collaboratorError) ||
    firstError(project.annotations.list, annotationError);
  if (error) {
    return error;
  }
  if (!project.collaborators.list.some(isAnyone)) {
    return 'The collaborators list needs an \'anyone\' entry';
  }

  return null;
};

/**
 * Usernames among `names` that have no user document
 * @param {object} db Monk database
 * @param {Array<string>} names Usernames
 * @returns {Promise<Array<string>>} The missing ones
 */
const missingUsers = async (db, names) => {
  const unique = _.uniq(names);
  const found = await db.get('users').distinct('username', { username: { $in: unique } });

  return unique.filter((name) => !found.includes(name));
};

/**
 * The users that must exist: the owner of a new project, and the
 * collaborators that the stored project does not have yet (a stored project
 * may name users that were removed since: saving it again must stay possible)
 * @param {object} project The project sent
 * @param {object|undefined} oldProject The stored project
 * @param {string} owner The owner
 * @returns {Array<string>} Usernames
 */
const usersToCheck = (project, oldProject, owner) => {
  const known = oldProject && oldProject.collaborators && Array.isArray(oldProject.collaborators.list) ?
    oldProject.collaborators.list.filter(_.isPlainObject).map(collaboratorName) :
    [];
  const names = project.collaborators.list
    .filter((c) => !isAnyone(c))
    .map(collaboratorName)
    .filter((name) => !known.includes(name));

  return oldProject ? names : [owner, ...names];
};

/**
 * Parse, sanitise and validate the project sent to POST /project/json/:projectName
 * @param {object} params { data: req.body.data, shortname: the name in the URL,
 *   oldProject: the stored project or undefined, owner: the owner to keep or set,
 *   db: Monk database }
 * @returns {Promise<object>} { project } or { error } (a 400 answer)
 */
// eslint-disable-next-line max-statements
const checkProject = async ({ data, shortname, oldProject, owner, db }) => {
  const parsed = parseProjectData(data);
  if (typeof parsed === 'undefined') {
    return { error: 'Invalid project data' };
  }
  const project = _.omit(sanitize(parsed), serverFields);
  const error = structureError(project, { shortname, isNew: _.isNil(oldProject) });
  if (error) {
    return { error };
  }
  // The owner is not set by the client: the stored one, or the creator.
  project.owner = owner;

  const missing = await missingUsers(db, usersToCheck(project, oldProject, owner));
  if (missing.length > 0) {
    return { error: `Unknown users: ${missing.join(', ')}` };
  }

  return { project };
};

module.exports = {
  annotationTypes,
  collaboratorName,
  checkProject,
  isAnyone,
  parseProjectData,
  plainText,
  sanitize,
  structureError
};
