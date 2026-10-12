/**
 * The check of the stored projects against the validation of project saves
 * (M3, decisions D27/D27a), shared by scripts/check-projects.js and the admin
 * section "Projects that don't validate" (A2, decisions D29), so that the two
 * cannot drift apart.
 *
 * For each stored project it lists:
 * - what would refuse saving it again unchanged from the settings page
 *   ('blocking');
 * - the stored rows that would be refused if they were new or changed
 *   (annotation layers named as another one included, F1), and the strings
 *   the sanitising would change ('warning');
 * - a shortname that is not alphanumeric ('shortname');
 * - the users it names that do not exist ('missing user');
 * and what the admin fixes can do about it: the blank rows they would
 * remove, and the unnamed layers that have values (with a proposed name).
 */
const crypto = require('crypto');
const _ = require('lodash');
const {
  asFileObject, collaboratorName, isAnyone, isBlank, listOf, nameKey, rowProblemList,
  sanitize, storedRows, structureError
} = require('./project.validation');

const KIND = {
  BLOCKING: 'blocking',
  WARNING: 'warning',
  SHORTNAME: 'shortname',
  MISSING_USER: 'missing user'
};

const listTypes = ['files', 'collaborators', 'annotations'];

/**
 * A token for the version of a stored project document: a hash of the
 * document as stored. The admin fixes refuse a project whose token changed
 * since it was listed.
 * @param {object} doc The project document, as read from the database
 * @returns {string} 20 hexadecimal digits
 */
const projectVersion = (doc) => crypto.createHash('sha256').update(JSON.stringify(doc))
  .digest('hex')
  .slice(0, 20);

// The project as the settings page sends it back: nwl-components turns files
// stored as plain strings into {source, name} (asFileObject, as the server's
// matching of stored rows does).
const asSentBySettingsPage = (project) => {
  const files = project.files && Array.isArray(project.files.list) ?
    { ...project.files, list: project.files.list.map(asFileObject) } :
    project.files;

  return { ..._.omit(project, ['_id', 'backup']), files };
};

/**
 * The rows the admin fix "remove blank rows" removes (decisions D29): a file
 * with no source, whatever its name (it cannot be shown); a collaborator with
 * no username and no userID, never 'anyone'; an annotation layer with no name
 * and no values. A missing (null) row counts as blank.
 */
const isRemovableRow = {
  files: (f) => _.isNil(f) || (typeof f === 'string' && isBlank(f)) || (_.isPlainObject(f) && isBlank(f.source)),
  collaborators: (c) => _.isNil(c) || (_.isPlainObject(c) && !isAnyone(c) && isBlank(c.username) && isBlank(c.userID)),
  annotations: (a) => _.isNil(a) || (_.isPlainObject(a) && isBlank(a.name) && isBlank(a.values))
};

/**
 * Indexes of the blank rows of each list
 * @param {object} project A project document
 * @returns {object} { files: [i], collaborators: [i], annotations: [i] }
 */
const blankRows = (project) => _.fromPairs(listTypes.map((type) => [
  type,
  listOf(project, type).map((row, i) => (isRemovableRow[type](row) ? i : -1))
    .filter((i) => i >= 0)
]));

const isUnnamedLayer = (a) => _.isPlainObject(a) && isBlank(a.name) && !isBlank(a.values);

/**
 * The annotation layers that have no name but have values, with a proposed
 * name "Layer N" that no other layer of the project has
 * @param {object} project A project document
 * @returns {Array<object>} [{ index, type, values, proposed }]
 */
const unnamedLayers = (project) => {
  const layers = listOf(project, 'annotations');
  const taken = new Set(layers.filter((a) => _.isPlainObject(a) && !isBlank(a.name)).map((a) => nameKey(a.name)));
  const list = [];
  layers.forEach((a, index) => {
    if (!isUnnamedLayer(a)) {
      return;
    }
    let n = index + 1;
    while (taken.has(nameKey(`Layer ${n}`))) {
      n += 1;
    }
    taken.add(nameKey(`Layer ${n}`));
    list.push({ index, type: a.type, values: a.values, proposed: `Layer ${n}` });
  });

  return list;
};

/**
 * The problems of a stored project, as if its owner saved it again unchanged
 * from the settings page (M3a2: stored rows are accepted unchanged)
 * @param {object} project A project document
 * @param {Set<string>} users The usernames that exist
 * @returns {Array<object>} [{ kind, message, list?, row?, users? }]
 */
// eslint-disable-next-line max-statements
const projectProblems = (project, users) => {
  const problems = [];
  const sent = sanitize(asSentBySettingsPage(project));
  const { stored } = storedRows(sent, project);
  const error = structureError(sent, { shortname: project.shortname, isNew: false, stored });
  if (error) {
    problems.push({ kind: KIND.BLOCKING, message: error });
  }
  for (const rowProblem of rowProblemList(sanitize(asSentBySettingsPage(project)))) {
    problems.push({ kind: KIND.WARNING, ...rowProblem });
  }
  if (!_.isEqual(sanitize(project), project)) {
    problems.push({ kind: KIND.WARNING, message: 'sanitising would change some strings (markup removed)' });
  }
  if (typeof project.shortname !== 'string' || !(/^[a-zA-Z0-9]+$/).test(project.shortname)) {
    problems.push({ kind: KIND.SHORTNAME, message: 'shortname is not alphanumeric (accepted for a stored project, refused for a new one)' });
  }
  const list = listOf(project, 'collaborators');
  const names = [project.owner, ...list.filter((c) => _.isPlainObject(c) && !isAnyone(c)).map(collaboratorName)];
  const missing = _.uniq(names.map((name) => (isBlank(name) ? '' : name)).filter((name) => !users.has(name)));
  if (missing.length > 0) {
    problems.push({
      kind: KIND.MISSING_USER,
      users: missing,
      message: `users that do not exist (kept on save): ${missing.map((name) => name || '(empty)').join(', ')}`
    });
  }

  return problems;
};

/**
 * A problem as one line of text, as scripts/check-projects.js prints it
 * @param {object} problem A problem from projectProblems
 * @returns {string} The line
 */
const formatProblem = (problem) => {
  if (problem.kind === KIND.BLOCKING) {
    return `refused: ${problem.message}`;
  }
  if (problem.kind === KIND.WARNING && typeof problem.list === 'string') {
    return `warning (stored row, accepted unchanged; refused if new or changed): ${problem.message}`;
  }

  return problem.message;
};

/**
 * Check one stored project
 * @param {object} project A project document
 * @param {Set<string>} users The usernames that exist
 * @returns {object} { shortname, name, owner, version, problems, blankRows:
 *   counts by list, unnamedLayers }
 */
const checkStoredProject = (project, users) => ({
  shortname: project.shortname,
  name: typeof project.name === 'string' ? project.name : '',
  owner: project.owner,
  version: projectVersion(project),
  problems: projectProblems(project, users),
  blankRows: _.mapValues(blankRows(project), (rows) => rows.length),
  unnamedLayers: unnamedLayers(project)
});

/**
 * Check every stored (non-backup) project. Read-only.
 * @param {object} db Monk database
 * @returns {Promise<object>} { total, refused, list }: the number of
 *   projects, of those that cannot be saved again unchanged, and the
 *   projects that have problems (checkStoredProject)
 */
const checkStoredProjects = async (db) => {
  const users = new Set(await db.get('users').distinct('username'));
  const projects = await db.get('projects').find({ backup: { $exists: false } });
  const list = projects.map((project) => checkStoredProject(project, users))
    .filter((p) => p.problems.length > 0);

  return {
    total: projects.length,
    refused: list.filter((p) => p.problems.some((q) => q.kind === KIND.BLOCKING)).length,
    list
  };
};

module.exports = {
  KIND,
  blankRows,
  checkStoredProject,
  checkStoredProjects,
  formatProblem,
  isRemovableRow,
  isUnnamedLayer,
  nameKey,
  projectProblems,
  projectVersion,
  unnamedLayers
};
