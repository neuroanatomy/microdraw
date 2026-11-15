/**
 * Who may see a dataset in the embeddable viewer (T002 3.7), as BrainBox's
 * mayEmbedMri (controller/mri/mri-access.js), with microdraw's access
 * functions: those the viewer and GET /api already use (NWL's
 * AccessControlService on the projects listing the source).
 *
 * - With a project: the visitor may view the project's files and its
 *   annotations, and the project lists the source.
 * - Without a project: the image alone, if a project listing it lets anyone
 *   view its files (public); otherwise refused.
 *
 * Cross-site iframes get no session cookie, so in practice an embed shows
 * what an anonymous visitor may see. No private-content tokens (BrainBox's
 * Phase 2 is not built either).
 */
const { AccessControlService, AccessType } = require('neuroweblab');
const { CURRENT, findCurrentProject } = require('../project/currentProject');
const log = require('../../log');

const ANYONE = 'anyone';

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/**
 * @param {Object} project A project document
 * @param {string} source A dataset's source URL
 * @returns {boolean} True if the project lists the source (a file row, or a
 *   legacy string row)
 */
const listsSource = (project, source) => {
  const list = project && project.files && project.files.list;

  return Array.isArray(list) && list.some((f) => f === source || (f && typeof f === 'object' && f.source === source));
};

/**
 * The current versions of the projects that list a source
 * @param {Object} db Native MongoDB Db
 * @param {string} source The source URL
 * @returns {Promise<Array>} The projects
 */
const projectsListing = (db, source) => db.collection('projects')
  .find({ $or: [{ 'files.list.source': source }, { 'files.list': source }], ...CURRENT })
  .toArray();

/**
 * A boolean access check that never throws (a malformed project denies)
 * @param {Function} check An AccessControlService check
 * @param {Object} project The project
 * @param {string} username The username, or 'anyone'
 * @returns {boolean} The answer
 */
const allows = (check, project, username) => {
  try {
    return Boolean(check(project, username));
  } catch (err) {
    return false;
  }
};

const mayViewProject = (project, username) => allows(AccessControlService.canViewFiles, project, username) &&
  allows(AccessControlService.canViewAnnotations, project, username);

const isPublic = (project) => allows(AccessControlService.canViewFiles, project, ANYONE);

const refusal = (status, message) => ({ status, message });
const NOT_FOUND = refusal(404, 'This dataset could not be found.');
const PROJECT_NOT_FOUND = refusal(404, 'This project could not be found.');
const PRIVATE = refusal(403, 'This content is private.');

/**
 * Whether a visitor may see a dataset in the embed (GET /data/embed)
 * @param {Object} db Native MongoDB Db
 * @param {Object} params Parameters
 * @param {string} params.source The source URL
 * @param {string} [params.project] The project's shortname
 * @param {string} params.username The username, or 'anyone'
 * @returns {Promise<Object>} {status: 200, project} or {status, message}
 */
// eslint-disable-next-line max-statements
const mayEmbedData = async (db, { source, project, username }) => {
  if (isNonEmptyString(project)) {
    const found = await findCurrentProject(db, project);
    if (!found) {
      return PROJECT_NOT_FOUND;
    }
    // access first: a private project tells nothing of its files
    if (!mayViewProject(found, username)) {
      return PRIVATE;
    }
    if (!listsSource(found, source)) {
      return NOT_FOUND;
    }

    return { status: 200, project: found };
  }
  const projects = await projectsListing(db, source);
  if (projects.length === 0) {
    return NOT_FOUND;
  }
  if (!projects.some(isPublic)) {
    return PRIVATE;
  }

  return { status: 200, project: null };
};

/**
 * The annotation access level of a visitor in a project, as a string
 * @param {Object} project The project
 * @param {string} username The username, or 'anyone'
 * @returns {string} 'view', 'edit', ...
 */
const annotationsAccess = (project, username) => {
  try {
    return AccessControlService.getUserOrPublicAccessLevel(project, username, AccessType.ANNOTATIONS).toString();
  } catch (err) {
    return 'view';
  }
};

/**
 * The layers an embedding page may choose from (GET /data/layers), as
 * BrainBox's apiMriLayers: the projects listing the source whose files and
 * annotations the visitor may view, behind the embed's check
 * @param {Object} db Native MongoDB Db
 * @param {Object} params Parameters
 * @param {string} params.source The source URL
 * @param {string} params.username The username, or 'anyone'
 * @returns {Promise<Object>} {status: 200, layers} or {status, message}
 */
const embedLayers = async (db, { source, username }) => {
  const projects = await projectsListing(db, source);
  if (projects.length === 0) {
    return NOT_FOUND;
  }
  const visible = projects.filter((p) => mayViewProject(p, username));
  if (visible.length === 0 && !projects.some(isPublic)) {
    return PRIVATE;
  }

  return {
    status: 200,
    layers: visible.map((p) => ({
      project: p.shortname,
      name: isNonEmptyString(p.name) ? p.name : p.shortname,
      access: annotationsAccess(p, username)
    }))
  };
};

/*
  Read-only over HTTP. The embed page has no save path, and the server refuses
  any write (a method other than GET, HEAD or OPTIONS) that comes from it. It
  recognises one by any of three signals, each of which can only narrow
  rights, never widen them (fail closed):
  - the X-Microdraw-Embed header, which the embed page sends on each of its
    requests, whatever its value (a ticket, an empty string);
  - a Referer whose path is /data/embed (the embed document);
  - Sec-Fetch-Dest: iframe or frame, set by the browser, which script cannot
    change: a form posted into a frame. microdraw writes with fetch, never by
    navigating a frame.
  A script running inside the embed document could leave out the header and
  the referrer, but it then has the visitor's own rights, as on /data, and a
  cross-site iframe sends no session cookie, so those writes are refused for
  want of a user (401).
*/
const EMBED_HEADER = 'x-microdraw-embed';
const EMBED_PATH = '/data/embed';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {Object} req The request
 * @returns {boolean} True if the request comes from the embed page
 */
// eslint-disable-next-line max-statements
const isFromEmbed = (req) => {
  if (typeof req.headers[EMBED_HEADER] !== 'undefined') {
    return true;
  }
  const dest = req.headers['sec-fetch-dest'];
  if (dest === 'iframe' || dest === 'frame') {
    return true;
  }
  const { referer } = req.headers;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const { pathname } = new URL(referer, 'http://referer.invalid');

      return pathname === EMBED_PATH || pathname.startsWith(`${EMBED_PATH}/`);
    } catch (err) {
      return false;
    }
  }

  return false;
};

/**
 * Express middleware: refuse every write from the embed page (403)
 * @param {Object} req The request
 * @param {Object} res The response
 * @param {Function} next The next handler
 * @returns {void}
 */
const refuseEmbedWrites = (req, res, next) => {
  if (!SAFE_METHODS.has(req.method) && isFromEmbed(req)) {
    (req.log || log).warn({ method: req.method, path: req.path }, 'write from an embedded viewer refused');
    res.status(403).json({ error: 'An embedded viewer cannot edit' });

    return;
  }
  next();
};

module.exports = {
  listsSource,
  projectsListing,
  mayEmbedData,
  embedLayers,
  isFromEmbed,
  refuseEmbedWrites,
  EMBED_HEADER
};
