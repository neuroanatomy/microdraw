/* eslint-disable max-lines -- one handler per admin route; 2026-10-12 */
const logger = require('../../log');
const admins = require('./admins');
const annotations = require('./admin.annotations');
const projects = require('./admin.projects');
const projectActions = require('./admin.projectActions');
const damaged = require('./admin.damaged');
const datasets = require('./admin.datasets');
const microdrawWebsocketServer = require('../microdrawWebsocketServer/microdrawWebsocketServer');
const nwl = require('neuroweblab');

// Follows BrainBox controller/admin/admin.controller.js (requireAdmin,
// adminPage, the JSON handlers), so that the two can be merged later.

// requireAdmin: admins only (logged in, or authenticated by a token), 401/403 JSON
const { requireAdmin, requestUsername } = admins;

// { shortname, version } from the body of a fix, or { error } (NeuroWebLab 1.24.0)
const { projectFromBody } = nwl;

// The admin page: 401 askForLogin when logged out, 403 to non-admins
const adminPage = admins.adminPage({
  title: 'MicroDraw: Admin',
  loginPrompt: { login: '<a href=\'/auth/github\'>Log in with GitHub</a>' }
});

const serverError = (res, err) => {
  logger.error({ err }, 'admin request failed');
  res.status(500).json({ success: false, error: 'Server error' });
};

// Answer with the result of an action, or its error (500 logged as serverError)
const sendResult = (res, action) => nwl.sendResult(res, action, { logger });

const nativeDb = (req) => req.app.db.nativeMongoDB();

const intParam = (value, fallback, max) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }

  return Math.min(n, max);
};

/**
 * List the orphan annotations, grouped by image, author and project value.
 * Query: skip, limit (default 50, at most 500), source (one image only)
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const getOrphans = async (req, res) => {
  const skip = intParam(req.query.skip, 0, Number.MAX_SAFE_INTEGER);
  const limit = intParam(req.query.limit, 50, 500) || 50;
  const source = typeof req.query.source === 'string' ? req.query.source : '';
  try {
    const { total, list } = await annotations.findOrphanAnnotations(nativeDb(req), { skip, limit, source });
    res.json({ success: true, total, skip, limit, list });
  } catch (err) {
    serverError(res, err);
  }
};

const groupFromBody = (body) => ({ fileID: body.fileID, user: body.user, project: body.project });

/**
 * Remove an orphan group (mark it as backup; undo with restoreOrphans).
 * Body: { fileID, user, project }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const removeOrphans = (req, res) => {
  const group = groupFromBody(req.body || {});
  const error = annotations.groupError(group);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  sendResult(res, annotations.removeOrphans(nativeDb(req), { group, username: requestUsername(req) }));
};

/**
 * Undo the removal of an orphan group. Body: { log } (the id returned by remove)
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const restoreOrphans = (req, res) => {
  const { log } = req.body || {};
  if (typeof log !== 'string' || log === '') {
    return res.status(400).json({ success: false, error: 'Provide the log id of the removal' });
  }
  sendResult(res, annotations.restoreOrphans(nativeDb(req), { logId: log, username: requestUsername(req) }));
};

/**
 * The projects that list the image of an orphan group, with the number of
 * annotations they already have on it. Query: fileID, user
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const getOrphanProjects = (req, res) => {
  const { fileID } = req.query;
  const user = typeof req.query.user === 'string' ? req.query.user : null;
  if (typeof fileID !== 'string' || fileID === '') {
    return res.status(400).json({ success: false, error: 'Provide the fileID' });
  }
  sendResult(res, annotations.candidateProjects(nativeDb(req), { fileID, user }).then((list) => ({ list })));
};

/**
 * Assign an orphan group to a project.
 * Body: { fileID, user, project, target, addImage }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const assignOrphans = (req, res) => {
  const body = req.body || {};
  const group = groupFromBody(body);
  const error = annotations.groupError(group);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  if (typeof body.target !== 'string' || body.target === '') {
    return res.status(400).json({ success: false, error: 'Provide the target project' });
  }
  sendResult(res, annotations.assignOrphans(nativeDb(req), {
    group,
    target: body.target,
    addImage: body.addImage === true,
    username: requestUsername(req)
  }));
};

/**
 * List the stored projects that don't validate (A2), as
 * scripts/check-projects.js does
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const getInvalidProjects = (req, res) => {
  sendResult(res, projects.findInvalidProjects(req.app.db.nativeMongoDB()));
};

/**
 * Remove the blank rows of a project. Body: { project, version }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const removeBlankRows = (req, res) => {
  const { shortname, version, error } = projectFromBody(req.body || {});
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  sendResult(res, projects.removeBlankRows(req.app.db, { shortname, version, username: requestUsername(req) }));
};

/**
 * Name the unnamed layers of a project. Body: { project, version, names: { index: name } }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const nameLayers = (req, res) => {
  const body = req.body || {};
  const { shortname, version, error } = projectFromBody(body);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  if (!body.names || typeof body.names !== 'object' || Array.isArray(body.names) || Object.keys(body.names).length === 0) {
    return res.status(400).json({ success: false, error: 'Provide the names: { index: name }' });
  }
  sendResult(res, projects.nameLayers(req.app.db, { shortname, version, names: body.names, username: requestUsername(req) }));
};

/**
 * Undo a project fix. Body: { log } (the id returned by the fix)
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const restoreProject = (req, res) => {
  const { log } = req.body || {};
  if (typeof log !== 'string' || log === '') {
    return res.status(400).json({ success: false, error: 'Provide the log id of the fix' });
  }
  sendResult(res, projects.restoreProject(req.app.db, { logId: log, username: requestUsername(req) }));
};

/**
 * Find projects by shortname or name (A3). Query: q
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const searchProjects = (req, res) => {
  const { q } = req.query;
  if (typeof q !== 'string' || q.trim() === '') {
    return res.status(400).json({ success: false, error: 'Provide the text to search for in q' });
  }
  sendResult(res, projectActions.searchProjects(nativeDb(req), q.trim()));
};

/**
 * Delete a project, as its owner would (A3). Body: { project, version }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const deleteProject = (req, res) => {
  const { shortname, version, error } = projectFromBody(req.body || {});
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  sendResult(res, projectActions.deleteProject(req.app.db, { shortname, version, username: requestUsername(req) }));
};

/**
 * Undo a project delete (an admin's or an owner's). Body: { log }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const restoreDeletedProject = (req, res) => {
  const { log } = req.body || {};
  if (typeof log !== 'string' || log === '') {
    return res.status(400).json({ success: false, error: 'Provide the log id of the delete' });
  }
  sendResult(res, projectActions.restoreDeleted(req.app.db, { logId: log, username: requestUsername(req) }));
};

/**
 * Give a project to another existing user (A3). Body: { project, version, owner }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const transferProject = (req, res) => {
  const body = req.body || {};
  const { shortname, version, error } = projectFromBody(body);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  if (typeof body.owner !== 'string' || body.owner.trim() === '') {
    return res.status(400).json({ success: false, error: 'Provide the username of the new owner' });
  }
  sendResult(res, projectActions.transferProject(req.app.db, { shortname, version, owner: body.owner, username: requestUsername(req) }));
};

// The damaged projects routes (T002 3.6 A): list them, restore the files a
// save removed (undone by restoreProject), keep the newest of several current
// versions. NeuroWebLab 1.24.0's handlers, same bodies, texts and answers.
const { getDamagedProjects, restoreProjectFiles, fixProjectCurrentVersions } = nwl.damagedProjectsRoutes(damaged, { nativeDb, requestUsername, logger });

const sourceError = (source) => (typeof source !== 'string' || source === '' || source.length > 2048 ? 'Provide the source: the URL of the dataset' : null);

/**
 * One dataset (T002 3.6 B): its document, the projects that list it, its
 * annotations per project and user, and how many viewers have it open.
 * Query: source
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const getDataset = (req, res) => {
  const { source } = req.query;
  const error = sourceError(source);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  sendResult(res, datasets.findDataset(nativeDb(req), source)
    .then((found) => ({ ...found, viewers: microdrawWebsocketServer.viewersOfSource(source) })));
};

/**
 * Set the owner and/or the name of a dataset's document (created if there is
 * none). Body: { source, owner?, name? }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const updateDataset = (req, res) => {
  const { source, owner, name, error } = datasets.checkUpdate(req.body || {});
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  sendResult(res, datasets.updateDataset(nativeDb(req), { source, owner, name, username: requestUsername(req) }));
};

const openError = (source) => {
  const viewers = microdrawWebsocketServer.viewersOfSource(source);

  return viewers > 0 ? `${viewers} viewer(s) have this dataset open: try again when nobody is using it` : null;
};

/**
 * Remove the current annotations of a dataset in a project, by a user or
 * all; refused while someone has the dataset open. Body: { source, project, user? }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const removeDatasetAnnotations = (req, res) => {
  const { source, project, user } = req.body || {};
  const error = sourceError(source) ||
    (typeof project !== 'string' || project === '' ? 'Provide the project' : null) ||
    (typeof user !== 'undefined' && typeof user !== 'string' ? 'The user must be a username, or left out for all' : null);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  const open = openError(source);
  if (open) {
    return res.status(409).json({ success: false, error: open });
  }
  sendResult(res, datasets.removeAnnotations(nativeDb(req), { source, project, user, username: requestUsername(req) }));
};

/**
 * Undo a removal of dataset annotations; refused while the dataset is open.
 * Body: { log }
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const restoreDatasetAnnotations = async (req, res) => {
  const { log } = req.body || {};
  if (typeof log !== 'string' || log === '') {
    return res.status(400).json({ success: false, error: 'Provide the log id of the removal' });
  }
  try {
    const source = await datasets.removalSource(nativeDb(req), log);
    const open = source && openError(source);
    if (open) {
      return res.status(409).json({ success: false, error: open });
    }
  } catch (err) {
    return serverError(res, err);
  }
  sendResult(res, datasets.restoreAnnotations(nativeDb(req), { logId: log, username: requestUsername(req) }));
};

/**
 * Send a message to every viewer connected to the live-update server
 * (T002 3.6 C). Body: { message }, at most 500 characters. Logged.
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
// eslint-disable-next-line max-statements
const broadcastMessage = async (req, res) => {
  const msg = nwl.noticeMessage((req.body || {}).message);
  if (msg === null) {
    return res.status(400).json({ success: false, error: `Provide the message: 1 to ${nwl.MAX_NOTICE_LENGTH} characters` });
  }
  const username = requestUsername(req);
  try {
    const viewers = microdrawWebsocketServer.broadcastNotice(msg);
    logger.info({ event: 'adminBroadcast', username, viewers }, 'admin: adminBroadcast');
    await nativeDb(req).collection('log')
      .insertOne({ key: 'adminBroadcast', value: { username, message: msg, viewers }, date: (new Date()).toJSON() });
    res.json({ success: true, viewers });
  } catch (err) {
    serverError(res, err);
  }
};

module.exports = {
  requireAdmin,
  adminPage,
  getOrphans,
  removeOrphans,
  restoreOrphans,
  getOrphanProjects,
  assignOrphans,
  getInvalidProjects,
  removeBlankRows,
  nameLayers,
  restoreProject,
  searchProjects,
  deleteProject,
  restoreDeletedProject,
  transferProject,
  getDamagedProjects,
  restoreProjectFiles,
  fixProjectCurrentVersions,
  getDataset,
  updateDataset,
  removeDatasetAnnotations,
  restoreDatasetAnnotations,
  broadcastMessage
};
