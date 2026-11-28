/* eslint-disable max-lines -- long controller, split later; 2026-10-11 */
/* eslint-disable radix */
/* eslint-disable no-plusplus */
// const async = require('async');
// const dateFormat = require('dateformat');
// const checkAccess = require('../checkAccess/checkAccess.js');
// const dataSlices = require('../dataSlices/dataSlices.js');
const _ = require('lodash');
const logger = require('../../log');
const { AccessControlService, AccessLevel, visibleProject } = require('neuroweblab');
const { asFileObject, checkProject, collaboratorName, listOf, withBothKeys } = require('./project.validation');
const { deleteStoredProject } = require('./project.delete');
const { findCurrentProject, saveProjectVersion } = require('./currentProject');
const { currentTextValues } = require('../textAnnotations');
const { canSaveProject, catchErrors, droppedMessage, filesListIncomplete, ignoredChangesMessage, jsonForScript, keepFieldsWithoutFilesEdit, keepListsWithoutEditRights, projectFilesRoute, projectListRoute, saveRefusal } = require('neuroweblab');
const { cziServiceForScript } = require('../cziService');
const { noViewStatus, projectDeleteRoute, projectJsonRoute, projectKey, projectPageRoute, projectSaveRoute, projectSettingsRoute, visitor } = require('neuroweblab');
const { escapeHTML } = require('../escape');
const validator = function (req, res, next) {
  next();
};

// The username of the requester (session or API token: NWL's visitor), or
// microdraw's sentinel 'anyone' when logged out
const getLoggedUser = (req) => visitor(req) || 'anyone';

// What every project route asks of microdraw (NeuroWebLab 1.17.0 and
// 1.21.0): the native db and the view right
const db = (req) => req.appConfig.db.nativeMongoDB();
const canView = (req, json) => AccessControlService.canViewFiles(json, getLoggedUser(req));

/**
 * GET /project/:projectName: the project page (NeuroWebLab's
 * projectPageRoute: the return path, 404, the view right; an error goes to
 * the app's errorHandler). Only what the visitor may see goes into the page
 * (M3).
 */
const project = projectPageRoute({
  db,
  canView,
  render: (req, res, json) => {
    const login = (req.user) ?
      ('<a href=\'/user/' + escapeHTML(encodeURIComponent(req.user.username)) + '\'>' + escapeHTML(req.user.username) + '</a> (<a href=\'/logout\'>Log Out</a>)') :
      ('<a href=\'/auth/github\'>Log in with GitHub</a>');
    res.render('project', {
      projectShortname: json.shortname,
      projectName: json.name,
      projectInfo: jsonForScript(visibleProject(json, getLoggedUser(req))),
      wsPort: req.app.get('wsPort') || 8080,
      cziService: cziServiceForScript(),
      login
    });
  }
});

// The project the settings page shows for an unknown shortname, owned by the
// visitor (or 'anyone' when logged out)
const blankProject = (req) => ({
  name: "",
  shortname: req.params.projectName,
  url: "",
  created: (new Date()).toJSON(),
  owner: getLoggedUser(req),
  collaborators: {
    list: [
      {
        username: 'anyone',
        userID: 'anyone',
        access: {
          collaborators: 'view',
          annotations: 'edit',
          files: 'view'
        }
      }
    ]
  },
  files: {
    list: []
  },
  annotations: {
    list: []
  }
});

/**
 * The display name of each collaborator, from the users collection; a row
 * whose user is not found keeps its stored name (or ''). A failing read is
 * logged, and the rows are kept as they are.
 * @param {object} req The request
 * @param {Array} list The collaborators' rows
 * @returns {Promise<Array>} The rows, with their names
 */
const withCollaboratorNames = async (req, list) => {
  try {
    const names = _.uniq(list.map(collaboratorName).filter((name) => typeof name === 'string'));
    const users = await db(req).collection('users')
      .find({ username: { $in: names } }, { projection: { _id: 0, username: 1, name: 1 } })
      .toArray();
    const nameOf = new Map(users.map((u) => [u.username, u.name]));

    return list.map((c) => {
      if (!_.isPlainObject(c)) {
        return c;
      }
      const found = nameOf.get(collaboratorName(c));

      return { ...c, name: typeof found === 'string' ? found : (c.name || '') };
    });
  } catch(e) {
    logger.error({ err: e, project: req.params.projectName }, 'cannot resolve collaborator names');

    return list;
  }
};

/**
 * GET /project/:projectName/settings: the settings page (NeuroWebLab's
 * projectSettingsRoute: the return path, the view right of a stored project,
 * the blank project of an unknown one; an error goes to the app's
 * errorHandler).
 */
const settings = projectSettingsRoute({
  db,
  canView,
  blankProject,
  render: async (req, res, stored) => {
    const loggedUser = getLoggedUser(req);

    // the files are not in the page: the settings page loads them in batches
    // from /project/json/:p/files, and says how many it received in
    // filesLoaded.count when saving (see filesListIncomplete), as BrainBox
    // does (T002 3.1)
    const filesTotal = listOf(stored, 'files').length;

    // only what the visitor may see goes into the page, as on the project
    // page (M3c, S2): no annotation layers without annotations view rights,
    // no collaborators but 'anyone' without collaborators view rights
    const canViewCollaborators = AccessControlService.canViewCollaborators(stored, loggedUser);
    const json = visibleProject(stored, loggedUser);

    // every row shown with username and userID, equal, whichever of the two
    // is stored (T002 2.2: before, a row without `username` answered an error
    // text)
    json.collaborators.list = json.collaborators.list.map(withBothKeys);
    if (canViewCollaborators) {
      json.collaborators.list = await withCollaboratorNames(req, json.collaborators.list);
    }

    json.files = { ...json.files, list: [] };
    json.filesLoaded = { count: 0 };

    res.render('projectSettings', {
      projectShortname: json.shortname,
      owner: json.owner,
      projectInfo: jsonForScript(json),
      filesTotal,
      loggedUser: jsonForScript(req.user || null)
    });
  }
});

/**
 * @function projectNew
 * @desc Render the page with the GUI for entering a new project
 * @param {Object} req Req object from express
 * @param {Object} res Res object from express
 * @returns {void}
 */
const projectNew = function (req, res) {
  // Store return path in case of login
  req.session.returnTo = req.originalUrl;

  if (visitor(req) === null) {
    res.render('askForLogin', {
      title: "MicroDraw: New Project",
      functionality: "create a new project",
      loggedUser: jsonForScript(req.user || null)
    });
  } else {
    res.render('projectNew', {
      title: "MicroDraw: New Project",
      loggedUser: jsonForScript(req.user || null)
    });
  }
};

/**
 * GET /project/json/:projectName: the project as the visitor may see it, or
 * with ?var=a/b the value at that path (NeuroWebLab's projectJsonRoute: 404,
 * the view right, own properties only; an error, as a ?var= path through a
 * missing value, goes to the app's errorHandler, a 500). No _id (the default
 * projection): it changes on every save (T002 2.1b), and no client reads it.
 */
const apiProject = projectJsonRoute({
  db,
  canView,
  visible: (req, json) => visibleProject(json, getLoggedUser(req))
});

// GET /project/json/:projectName/text-annotations: the current values of the
// project's named text layers, { <source>: { <layer>: {value, user, modified} } }.
// Answers as GET /project/json/:projectName for an unknown project (404) or one
// the visitor may not see (401 logged out, 403 logged in), and only for the files and layers the project
// page shows the visitor (NWL visibleProject): {} if the layers are hidden (M3c).
// The 404 text is the JSON route's since NeuroWebLab 1.21.0 (`No project <name>`).
const apiTextAnnotationsUnsafe = async function (req, res) {
  const json = await findCurrentProject(db(req), req.params.projectName);
  if (_.isNil(json)) {
    res.status(404).json({error: `No project ${req.params.projectName}`});

    return;
  }
  const loggedUser = getLoggedUser(req);
  if (!AccessControlService.canViewFiles(json, loggedUser)) {
    res.status(noViewStatus(req)).json({error: 'Not authorized to view project'});

    return;
  }
  res.json(await currentTextValues(db(req), visibleProject(json, loggedUser)));
};

const apiTextAnnotations = catchErrors(apiTextAnnotationsUnsafe);

// The file entry the files route answers: `names=true`, only {source, name}
// (a string entry, stored before files were objects, as the settings page
// showed it when the files were in the page, nwl-components'
// transformProjectFiles: {source, name: the text after the last '/'}; the
// stored-row check, asFileObject, matches it, T002 3.1)
const fileEntry = (entry, onlyNames) => {
  if (typeof entry === 'string') {
    return asFileObject(entry);
  }
  if (!_.isPlainObject(entry)) {
    return { source: String(entry), name: '' };
  }

  return onlyNames ? { source: entry.source, name: typeof entry.name === 'string' ? entry.name : '' } : entry;
};

// What the NeuroWebLab routes ask of microdraw (1.17.0, M10b): the native
// db, the view right (as on the other project routes) and its refusal status
// (NWL's: 401 logged out, 403 logged in)
const routeAdapter = { db, canView, noViewStatus };

/**
 * GET /project/json?page: the shortnames of the projects the requester may
 * view, 20 per page (NeuroWebLab's projectListRoute: fetch, filter for view
 * access, then page, so that a page never holds projects the requester may
 * not see). A failing read goes to the app's errorHandler.
 */
const apiProjectAll = projectListRoute({
  ...routeAdapter,
  row: (req, json) => json.shortname,
  projection: { _id: 0, shortname: 1, owner: 1, collaborators: 1 }
});

/**
 * GET /project/json/:projectName/files?start&length[&names=true]: a slice of
 * the current version's files (NeuroWebLab's projectFilesRoute): `start` and
 * `length` are required (200 {error} without them), the slice is cut to the
 * list (an empty list past its end), `names=true` sends {source, name} only.
 * Unknown project: 404 {error}; no view right: 401 logged out, 403 logged in
 * (shared suite 1.5, route:files). A failing read goes to the app's
 * errorHandler.
 */
const apiProjectFiles = projectFilesRoute({
  ...routeAdapter,
  entries: (req, json, slice, { names }) => slice.map((entry) => fileEntry(entry, names))
});

// What two versions of a list are compared on, by list: a collaborator's name
// and access (the settings page adds a display name), the whole entry
// otherwise. The `rowKey` given to NWL's keepListsWithoutEditRights.
const comparableEntry = {
  collaborators: (c) => ({ user: collaboratorName(c), access: c.access }),
  files: (f) => f,
  annotations: (a) => a
};

// The reason goes in `error`, which the settings page shows (nwl-components
// ProjectInfo.vue), and in `message`, for the clients that read it
const sendError = (res, status, message) => res.status(status).json({ success: false, error: message, message });

/**
 * Validate and store a project. Runs holding the project's lock: the stored
 * version it reads is still the current one when it writes.
 * @param {object} req Request object
 * @param {object} res Response object
 * @param {string} loggedUser The user saving
 * @returns {Promise<void>} Resolves once answered
 */
// eslint-disable-next-line max-statements
const saveProject = async function (req, res, loggedUser) {
  const shortname = req.params.projectName;
  const oldProject = await findCurrentProject(req.appConfig.db.nativeMongoDB(), shortname);
  if (!_.isNil(oldProject) && !canSaveProject(oldProject, loggedUser)) {
    res.status(403).json(saveRefusal());

    return;
  }

  const { project: newProject, dropped, error } = await checkProject({
    data: req.body.data,
    shortname,
    oldProject,
    owner: _.isNil(oldProject) ? loggedUser : oldProject.owner,
    db: req.appConfig.db.nativeMongoDB()
  });
  if (error) {
    sendError(res, 400, error);

    return;
  }

  // an incomplete files list (a save made before the settings page received
  // every file) is replaced by the stored one, before the rights are checked:
  // the files are then unchanged. filesLoaded is never stored. NWL's
  // filesListIncomplete sets dropped.files = 0 when the list is incomplete.
  const filesIncomplete = filesListIncomplete(newProject, oldProject, dropped);
  delete newProject.filesLoaded;
  if (filesIncomplete) {
    newProject.files.list = listOf(oldProject, 'files');
  }

  let ignoredChanges = [];
  if (!_.isNil(oldProject)) {
    ignoredChanges = keepListsWithoutEditRights(newProject, oldProject, loggedUser, { rowKey: comparableEntry });
    ignoredChanges = _.union(ignoredChanges, keepFieldsWithoutFilesEdit(newProject, oldProject, loggedUser));
  }

  // a list put back as stored (no rights to change it) is written with both
  // keys too (T002 2.2)
  newProject.collaborators.list = newProject.collaborators.list.map(withBothKeys);

  let successMessage = _.isNil(oldProject) ? 'New project created.' : 'Project settings updated.';
  successMessage += ignoredChangesMessage(ignoredChanges);
  if (filesIncomplete) {
    successMessage += ' The list of files was not saved because it had not been completely loaded: reload the page to edit it.';
  }
  successMessage += droppedMessage(dropped);

  // A new version (T002 2.1b): `modified` and `modifiedBy` are set by the
  // server, as BrainBox does (a date sent by the client is ignored), and so is
  // `_id` (checkProject drops the client's). A new project is a first version;
  // for an existing one, the version read above becomes `backup: true`. The
  // new version starts from the stored one, as the $set of NWL's upsertProject
  // did before 2.1b: a top-level field the client did not send is kept.
  try {
    const version = _.isNil(oldProject) ? newProject : { ..._.omit(oldProject, ['deletedWithProject', 'filesLoaded']), ...newProject };
    const saved = await saveProjectVersion(req.appConfig.db.nativeMongoDB(), version, { by: loggedUser });
    res.json({success: true, response: { insertedId: saved._id }, message: successMessage, dropped});
  } catch (err) {
    logger.error({ err, project: shortname, user: loggedUser }, 'cannot save project');
    sendError(res, 500, 'The project could not be saved');
  }
};

// The project's lock (NWL's project/lock.js, as projectLock.js)
const lockKeys = (req) => [projectKey(req.params.projectName)];

/**
 * POST /project/json/:projectName (NeuroWebLab's projectSaveRoute: 401
 * logged out, then saveProject holding the project's lock; any other error,
 * e.g. the database, goes to the app's errorHandler, a 500).
 */
const postProject = projectSaveRoute({ lockKeys, save: saveProject });

/**
 * DELETE /project/json/:projectName (NeuroWebLab's projectDeleteRoute: 401
 * logged out; holding the project's lock, 404, the REMOVE right, then the
 * delete). The project is deleted and its annotations marked as backups
 * (never deleted). The project document is kept in the `log` collection, and
 * the annotations it marks carry the id of that log entry, so an admin can
 * restore it (decisions D28, D31; project.delete.js, shared with the admin
 * delete). The whole document is read (`projection: {}`): the log entry keeps
 * its `_id`, as `projectId`.
 */
const deleteProject = projectDeleteRoute({
  db,
  projection: {},
  lockKeys,
  canRemove: (req, json) => {
    const loggedUser = getLoggedUser(req);
    const allowed = AccessControlService.hasFilesAccess(AccessLevel.REMOVE, json, loggedUser);
    if (!allowed) {
      logger.warn({ project: req.params.projectName, user: loggedUser }, 'delete refused: user does not have remove rights');
    }

    return allowed;
  },
  remove: async (req, json, username) => {
    const { log } = await deleteStoredProject(req.appConfig.db, { project: json, username });

    return { log };
  }
});

module.exports = {
  validator,
  apiProject,
  apiProjectAll,
  apiProjectFiles,
  apiTextAnnotations,
  project,
  projectNew,
  settings,
  postProject,
  deleteProject
};
