const { isAdmin, requestUsername } = require('./admins');
const annotations = require('./admin.annotations');
const projects = require('./admin.projects');
const { scriptJSON } = require('../escape');

// Follows BrainBox controller/admin/admin.controller.js (requireAdmin,
// adminPage, the JSON handlers), so that the two can be merged later.

/**
 * Let through only admins (logged in, or authenticated by a token)
 * @param {object} req Request object
 * @param {object} res Response object
 * @param {function} next Next middleware
 * @returns {void}
 */
const requireAdmin = (req, res, next) => {
  const username = requestUsername(req);
  if (!username) {
    return res.status(401).json({ success: false, error: 'User not authenticated' });
  }
  if (!isAdmin(username)) {
    return res.status(403).json({ success: false, error: 'Admins only' });
  }

  next();
};

/**
 * Render the admin page
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const adminPage = (req, res) => {
  const username = requestUsername(req);
  if (!username) {
    req.session.returnTo = req.originalUrl;
    res.status(401).render('askForLogin', {
      title: 'MicroDraw: Admin',
      functionality: 'use the admin tools',
      login: '<a href=\'/auth/github\'>Log in with GitHub</a>'
    });

    return;
  }
  if (!isAdmin(username)) {
    res.status(403).render('error', { message: 'Admins only' });

    return;
  }
  res.render('admin', {
    title: 'MicroDraw: Admin',
    loggedUser: scriptJSON({ username })
  });
};

const serverError = (res, err) => {
  console.log('ERROR:', err);
  res.status(500).json({ success: false, error: 'Server error' });
};

/**
 * Answer with the result of an action, or its error
 * @param {object} res Response object
 * @param {Promise<object>} action The action
 * @returns {Promise<void>} Resolves once answered
 */
const sendResult = async (res, action) => {
  try {
    const { status, error, ...result } = await action;
    if (error) {
      return res.status(status).json({ success: false, error });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    serverError(res, err);
  }
};

const db = (req) => req.app.db.mongoDB();

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
    const { total, list } = await annotations.findOrphanAnnotations(db(req), { skip, limit, source });
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
  sendResult(res, annotations.removeOrphans(db(req), { group, username: requestUsername(req) }));
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
  sendResult(res, annotations.restoreOrphans(db(req), { logId: log, username: requestUsername(req) }));
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
  sendResult(res, annotations.candidateProjects(db(req), { fileID, user }).then((list) => ({ list })));
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
  sendResult(res, annotations.assignOrphans(db(req), {
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
  sendResult(res, projects.findInvalidProjects(db(req)));
};

// { project, version } from the body of a fix, or the reason it is invalid
const projectFromBody = (body) => {
  if (typeof body.project !== 'string' || body.project === '') {
    return { error: 'Provide the project shortname' };
  }
  if (typeof body.version !== 'string' || body.version === '') {
    return { error: 'Provide the version of the project, as listed' };
  }

  return { shortname: body.project, version: body.version };
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
  restoreProject
};
