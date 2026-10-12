/* eslint-disable max-lines -- long controller, split later; 2026-10-11 */
/* eslint-disable radix */
/* eslint-disable no-plusplus */
// const async = require('async');
// const dateFormat = require('dateformat');
// const checkAccess = require('../checkAccess/checkAccess.js');
// const dataSlices = require('../dataSlices/dataSlices.js');
const _ = require('lodash');
const { AccessControlService, AccessLevel, AccessType } = require('neuroweblab');
const { checkProject, collaboratorName } = require('./project.validation');
const { withProjectLock } = require('../projectLock');
const { catchErrors } = require('../catchErrors');
const { scriptJSON, escapeHTML } = require('../escape');
const validator = function (req, res, next) {
  next();
};

// The username of the requester (session or API token), or 'anyone'.
const getLoggedUser = (req) => {
  if (req.isAuthenticated()) {
    return req.user.username;
  }
  if (req.isTokenAuthenticated) {
    return req.tokenUsername;
  }

  return 'anyone';
};

// eslint-disable-next-line max-statements -- existing handler, not refactored in a lint-only change; 2026-10-11
const project = async function (req, res) {
  const login = (req.user) ?
    ('<a href=\'/user/' + escapeHTML(encodeURIComponent(req.user.username)) + '\'>' + escapeHTML(req.user.username) + '</a> (<a href=\'/logout\'>Log Out</a>)') :
    ('<a href=\'/auth/github\'>Log in with GitHub</a>');
  const requestedProject = req.params.projectName;
  let loggedUser = "anyone";
  if(req.isAuthenticated()) {
    loggedUser = req.user.username;
  } else if(req.isTokenAuthenticated) {
    loggedUser = req.tokenUsername;
  }

  // Store return path in case of login
  req.session.returnTo = req.originalUrl;
  try {
    const json = await req.appConfig.db.queryProject({shortname: requestedProject});
    console.log('requestedProject', requestedProject);
    if (json) {
      if (!AccessControlService.canViewFiles(json, loggedUser)) {
        res.status(403).send('Not authorized to view project');

        return;
      }
      const context = {
        projectShortname: json.shortname,
        projectInfo: scriptJSON(json),
        login
      };
      res.render('project', context);
    } else {
      res.status(404).send('Project Not Found');
    }
  } catch(err) {
    console.log('ERROR:', err);
    res.status(400).send('Error');
  }
};

/**
 * @desc Render the settings page GUI
 * @param {Object} req Req object from express
 * @param {Object} res Res object from express
 * @returns {void}
 */
// eslint-disable-next-line max-statements -- existing handler, not refactored in a lint-only change; 2026-10-11
var settingsUnsafe = async function(req, res) {
  console.log("Settings");
  const requestedProject = req.params.projectName;

  var loggedUser = "anyone";
  if(req.isAuthenticated()) {
    loggedUser = req.user.username;
  } else if(req.isTokenAuthenticated) {
    loggedUser = req.tokenUsername;
  }

  req.session.returnTo = req.originalUrl;

  let json = await req.appConfig.db.queryProject({shortname: requestedProject});
  if(typeof json === 'undefined') {
    json = {
      name: "",
      shortname: requestedProject,
      url: "",
      created: (new Date()).toJSON(),
      owner: loggedUser,
      collaborators: {
        list: [
          {
            username: 'anyone',
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
    };
  }

  if (!AccessControlService.canViewFiles(json, loggedUser)) {
    res.status(403).send('Not authorized to view project');

    return;
  }

  // @todo empty the files.list because it will be filled progressively from the client
  // json.files.list = [];

  // find username and name for each of the collaborators in the project
  if (AccessControlService.canViewCollaborators(json, loggedUser)) {
    const arr1 = [];
    for(let j=0; j<json.collaborators.list.length; j++) {
      if (Object.keys(json.collaborators.list[j]).includes("username") === false) {

        return res.send("Error with user in project. Contact the adminstrators at https://mattermost.brainhack.org/brainhack/channels/microdraw").status(500);
      }

      arr1.push(req.appConfig.db.queryUser({username: json.collaborators.list[j].username}));
    }

    try {
      const collaboratorsList = await Promise.all(arr1);
      for(let j=0; j<collaboratorsList.length; j++) {
        if(collaboratorsList[j]) { // name found
          json.collaborators.list[j].name=collaboratorsList[j].name;
        } else { // name not found: set to empty
          json.collaborators.list[j].name = "";
        }
      }
    } catch(e) {
      console.error(e);
    }
  } else {
    json.collaborators.list = json.collaborators.list.filter((collaborator) => collaborator.username === 'anyone');
  }

  var context = {
    projectShortname: json.shortname,
    owner: json.owner,
    projectInfo: scriptJSON(json),
    loggedUser: scriptJSON(req.user || null)
  };
  res.render('projectSettings', context);
};

const settings = catchErrors(settingsUnsafe, (res) => res.status(500).send('Error'));

/**
 * @function projectNew
 * @desc Render the page with the GUI for entering a new project
 * @param {Object} req Req object from express
 * @param {Object} res Res object from express
 * @returns {void}
 */
const projectNew = function (req, res) {
  console.log("New Project");

  let loggedUser = "anyone";
  if(req.isAuthenticated()) {
    loggedUser = req.user.username;
  } else
  if(req.isTokenAuthenticated) {
    loggedUser = req.tokenUsername;
  }

  // Store return path in case of login
  req.session.returnTo = req.originalUrl;

  if(loggedUser === "anyone" ) {
    res.render('askForLogin', {
      title: "MicroDraw: New Project",
      functionality: "create a new project",
      loggedUser: scriptJSON(req.user || null)
    });
  } else {
    res.render('projectNew', {
      title: "MicroDraw: New Project",
      loggedUser: scriptJSON(req.user || null)
    });
  }
};

// eslint-disable-next-line max-statements -- existing handler, not refactored in a lint-only change; 2026-10-11
const apiProjectUnsafe = async function (req, res) {
  console.log("GET project", req.params);
  let json = await req.appConfig.db.queryProject({shortname: req.params.projectName, backup: {$exists: false}});
  if (_.isNil(json)) {
    res.status(404).json({error: 'Project not found'});

    return;
  }

  let loggedUser = "anyone";
  if(req.isAuthenticated()) {
    loggedUser = req.user.username;
  } else if(req.isTokenAuthenticated) {
    loggedUser = req.tokenUsername;
  }

  if (!AccessControlService.canViewFiles(json, loggedUser)) {
    res.status(403).json({error: 'Not authorized to view project'});

    return;
  }

  if (!AccessControlService.canViewCollaborators(json, loggedUser)) {
    json.collaborators.list = json.collaborators.list.filter((collaborator) => collaborator.username === 'anyone');
  }

  if (!AccessControlService.canViewAnnotations(json, loggedUser)) {
    json.annotations.list = [];
  }

  if (req.query.var) {
    let i;
    const arr = req.query.var.split('/');
    for (i in arr) {
      if({}.hasOwnProperty.call(arr, i)) {
        json = json[arr[i]];
      }
    }
  }
  // JSON, also when ?var= selects a string (res.send would send it as HTML)
  res.json(json);
};

// Any error in apiProjectUnsafe (a db failure, a ?var= path that does not
// exist) answers 500.
const apiProject = catchErrors(apiProjectUnsafe);

// Shortnames of all the projects the requester may view.
const viewableProjectNames = async (req) => {
  const loggedUser = getLoggedUser(req);
  const projects = await req.appConfig.db.mongoDB().get('projects')
    .find({backup: {$exists: false}}, {fields: {_id: 0, shortname: 1, owner: 1, collaborators: 1}});

  return projects
    .filter((o) => AccessControlService.canViewFiles(o, loggedUser))
    .map((o) => o.shortname);
};

// Lists the shortnames of the projects the requester may view, 20 per page.
// As BrainBox's getProjectsSlice: fetch, filter for view access, then page,
// so that a page never holds projects the requester may not see.
const apiProjectAll = async function (req, res) {
  if (!req.query.page) {
    res.json({error: 'The \'pages\' parameter has to be specified'});

    return;
  }

  const page = Math.max(0, parseInt(req.query.page) || 0);
  const nItemsPerPage = 20;

  try {
    const names = await viewableProjectNames(req);
    res.send(names.slice(page * nItemsPerPage, (page + 1) * nItemsPerPage));
  } catch (err) {
    console.log('ERROR:', err);
    res.status(500).json({error: 'Server error'});
  }
};

/**
 * @function apiProjectFiles
 */

/**
 * @todo Check access rights for this route
 */

const apiProjectFiles = function (req, res) {
  const {projectName} = req.params;
  const start = parseInt(req.query.start);
  const length = parseInt(req.query.length);

  console.log('projectName:', projectName, 'start:', start, 'length:', length);
  res.send({});
};

const listTypes = [AccessType.COLLABORATORS, AccessType.FILES, AccessType.ANNOTATIONS];

// What two versions of a list are compared on: a collaborator's name and
// access (the settings page adds a display name), the whole entry otherwise.
const comparableEntry = {
  collaborators: (c) => ({ user: collaboratorName(c), access: c.access }),
  files: (f) => f,
  annotations: (a) => a
};

/**
 * Keep the stored version of each list that the user may not edit (M3). NWL's
 * preventUnauthorizedUpdates only compares the lengths of the lists, so a
 * collaborator who may edit the files could otherwise change the access
 * values of the collaborators (their own included) or the annotation layers.
 * @param {object} newProject The project sent (changed in place)
 * @param {object} oldProject The stored project
 * @param {string} loggedUser The user saving
 * @returns {Array<string>} The lists whose changes were ignored
 */
const keepListsWithoutEditRights = (newProject, oldProject, loggedUser) => {
  const ignored = [];
  for (const type of listTypes) {
    const oldList = (oldProject[type] && Array.isArray(oldProject[type].list)) ? oldProject[type].list : [];
    const changed = !_.isEqual(newProject[type].list.map(comparableEntry[type]), oldList.map(comparableEntry[type]));
    if (changed && !AccessControlService.hasAccess(type, AccessLevel.EDIT, oldProject, loggedUser)) {
      newProject[type].list = oldList;
      ignored.push(type);
    }
  }

  return ignored;
};

// The blank new rows that checkProject left out (M3a2), for the message
const droppedMessage = (dropped) => {
  const parts = Object.entries(dropped)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`);

  return parts.length > 0 ? ` Empty rows were not saved (${parts.join(', ')}).` : '';
};

const sendError = (res, status, message) => res.status(status).json({ success: false, error: 'error', message });

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
  const oldProject = await req.appConfig.db.queryProject({shortname, backup: {$exists: false}});
  if (!_.isNil(oldProject) && !AccessControlService.hasFilesAccess(AccessLevel.EDIT, oldProject, loggedUser)) {
    sendError(res, 403, 'User does not have edit rights');

    return;
  }

  const { project: newProject, dropped, error } = await checkProject({
    data: req.body.data,
    shortname,
    oldProject,
    owner: _.isNil(oldProject) ? loggedUser : oldProject.owner,
    db: req.appConfig.db.mongoDB()
  });
  if (error) {
    sendError(res, 400, error);

    return;
  }

  let ignoredChanges = [];
  if (!_.isNil(oldProject)) {
    ignoredChanges = AccessControlService.preventUnauthorizedUpdates(newProject, oldProject, loggedUser);
    ignoredChanges = _.union(ignoredChanges, keepListsWithoutEditRights(newProject, oldProject, loggedUser));
  }

  let successMessage = _.isNil(oldProject) ? 'New project created.' : 'Project settings updated.';
  if(ignoredChanges.length > 0) {
    successMessage += ` Some changes (on ${ignoredChanges.join(', ')}) were ignored due to a lack of permissions.`;
  }
  successMessage += droppedMessage(dropped);

  try {
    const o = await req.appConfig.db.upsertProject(newProject);
    res.json({success: true, response: o, message: successMessage, dropped});
  } catch (err) {
    console.log('ERROR: postProject', err);
    sendError(res, 500, 'The project could not be saved');
  }
};

const postProjectUnsafe = async function (req, res) {
  const loggedUser = getLoggedUser(req);
  if (loggedUser === 'anyone') {
    sendError(res, 401, 'User not authenticated');

    return;
  }

  await withProjectLock(req.params.projectName, () => saveProject(req, res, loggedUser));
};

// Any other error (e.g. the database) answers 500.
const postProject = catchErrors(postProjectUnsafe);

/**
 * Delete a project and mark its annotations as backups (never deleted). The
 * project document is kept in the `log` collection, and the annotations it
 * marks carry the id of that log entry, so the deletion can be undone by hand
 * (decisions D28). Runs holding the project's lock.
 * @param {object} req Request object
 * @param {object} res Response object
 * @param {string} loggedUser The user deleting
 * @returns {Promise<void>} Resolves once answered
 */
// eslint-disable-next-line max-statements
const removeProject = async function (req, res, loggedUser) {
  const shortname = req.params.projectName;
  const projectToDelete = await req.appConfig.db.queryProject({shortname, backup: {$exists: false}});
  if (_.isNil(projectToDelete)) {
    res.status(404).json({ success: false, message: 'Project not found' });

    return;
  }
  if (!AccessControlService.hasFilesAccess(AccessLevel.REMOVE, projectToDelete, loggedUser)) {
    console.log('WARNING: user does not have remove rights');
    res.status(403).json({ success: false, message: 'The user is not allowed to delete this project' });

    return;
  }

  const db = req.appConfig.db.mongoDB();
  const current = { project: shortname, backup: { $exists: false } };
  const entry = await db.get('log').insert({
    key: 'deleteProject',
    value: { username: loggedUser, shortname, project: _.omit(projectToDelete, ['_id']), annotations: await db.get('annotations').count(current) },
    date: (new Date()).toJSON()
  });
  await db.get('annotations').update(current, { $set: { backup: true, deletedWithProject: String(entry._id) } }, { multi: true });
  await req.appConfig.db.deleteProject({shortname});
  console.log('DELETE Project', shortname, 'log', String(entry._id));
  res.json({success: true, message: 'Project deleted', log: String(entry._id)});
};

const deleteProjectUnsafe = async function (req, res) {
  const loggedUser = getLoggedUser(req);
  if (loggedUser === 'anyone') {
    res.status(401).json({ success: false, message: 'Log in required' });

    return;
  }

  await withProjectLock(req.params.projectName, () => removeProject(req, res, loggedUser));
};

const deleteProject = catchErrors(deleteProjectUnsafe);

module.exports = {
  validator,
  apiProject,
  apiProjectAll,
  apiProjectFiles,
  project,
  projectNew,
  settings,
  postProject,
  deleteProject
};
