/* eslint-disable camelcase */
/* eslint-disable radix */
// const async = require('async');
const dateFormat = require('dateformat');
const log = require('../../log');
const { AccessControlService } = require('neuroweblab');
const { jsonForScript } = require('neuroweblab');
const { visibleProject } = require('neuroweblab');
const { publicUser, userProjectsRoute, visitor } = require('neuroweblab');
const { lastModified, newestAnnotations } = require('./lastModified');
const { pageOf, userAnnotations, userDatasets } = require('./userTabs');
//const checkAccess = require('../checkAccess/checkAccess.js');

const validator = function (req, res, next) {
  // UserName can be an ip address (for anonymous users)

  /*
    req.checkParams('userName', 'incorrect user name').isAlphanumeric();
    var errors = req.validationErrors();
    console.log(errors);
    if (errors) {
        res.send(errors).status(403).end();
    } else {
        return next();
    }
    */
  next();
};

// What of a user others may see (GET /user/json/:userName and the userInfo of
// GET /user/:userName): NWL's publicUser, an allow-list of the username field
// (`username`, Configuration's usernameField) and PUBLIC_USER_FIELDS. Never
// passhash, tokens, email, or anything else stored on the user.

const user = function (req, res) {
  const username = req.params.userName;

  // Store return path in case of login
  req.session.returnTo = req.originalUrl;

  req.appConfig.db.queryUser({username})
    .then((json) => {
      if (json) {
        const context = {
          username, // json.name,
          // nickname: json.nickname,
          joined: dateFormat(json.joined, 'dddd d mmm yyyy, HH:MM'),
          avatar: json.avatarURL,
          title: json.name,
          userInfo: jsonForScript(publicUser(json)),
          tab: req.query.tab || 'data',
          loggedUser: jsonForScript(req.user || null)
        };
        res.render('user', context);
      } else {
        res.status(404).send('User Not Found');
      }
    })
    .catch((err) => {
      // NWL's queryUser rejects when there is no such user
      if (err && err.message === 'error find one user') {
        res.status(404).send('User Not Found');

        return;
      }
      log.error({ err, profile: req.params.userName }, 'user request failed');
      res.status(500).send('Error');
    });
};

const api_user = function (req, res) {
  req.appConfig.db.queryUser({username: req.params.userName, backup: {$exists: false}})
    .then((doc) => {
      if (doc) {
        let json = publicUser(doc);
        if (req.query.var) {
          for (const key of req.query.var.split('/')) {
            json = json[key];
          }
        }
        // JSON, also when ?var= selects a string (res.send would send it as HTML)
        res.json(json);
      } else {
        res.status(404).json({error: 'User not found'});
      }
    })
    .catch((err) => {
      if (err && err.message === 'error find one user') {
        res.status(404).send({error: 'User not found'});
      } else {
        log.error({ err, profile: req.params.userName }, 'user request failed');
        res.status(500).send({error: 'Server error'});
      }
    });
};

// Lists usernames, 20 per page, in stored order, as BrainBox's apiUserAll
// lists nicknames: current versions with a string username only.
const api_userAll = async function (req, res) {
  if (!req.query.page) {
    res.json({error: 'The \'pages\' parameter has to be specified'});

    return;
  }

  const page = Math.max(0, parseInt(req.query.page) || 0);
  const nItemsPerPage = 20;

  try {
    const users = await req.appConfig.db.queryAllUsers(
      {backup: {$exists: false}, username: {$type: 'string'}},
      {skip: page * nItemsPerPage, limit: nItemsPerPage, projection: {_id: 0, username: 1}}
    );
    res.send(users.map((o) => o.username));
  } catch (err) {
    log.error({ err }, 'cannot list users');
    res.status(500).json({error: 'Server error'});
  }
};


// Whether a user exists (the user page routes answer 404 for an unknown one)
const userExists = async (db, username) => Boolean(await db.collection('users')
  .findOne({ username, backup: { $exists: false } }, { projection: { _id: 1 } }));

/**
 * One page of a user page tab (T002 3.4, userTabs.js): every row the visitor
 * may see, then `length` of them (at most 100, 100 by default) from `start`
 * (0 by default). 404 for an unknown user.
 * @param {Function} rowsOf (db, username, visitor) → all the visible rows
 * @param {string} key The answer's success key: `success` for the datasets,
 *   `successful` for the annotations (as before, and as BrainBox's routes)
 * @returns {Function} The route
 */
const tabRoute = (rowsOf, key) => async function (req, res) {
  const username = req.params.userName;
  const { start, length } = pageOf(req.query);
  try {
    const db = req.appConfig.db.nativeMongoDB();
    if (await userExists(db, username)) {
      const rows = await rowsOf(db, username, req.user ? req.user.username : 'anyone');
      res.send({ [key]: true, list: rows.slice(start, start + length) });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    log.error({ err, profile: username }, 'user request failed');
    res.status(500).send({ [key]: false, list: [] });
  }
};

/**
 * GET /user/json/:userName/files?start&length: the Datasets tab, the
 * datasets the user owns that the visitor may see, newest first
 * ({url, name, included, projects})
 */
const api_userFiles = tabRoute(userDatasets, 'success');

/**
 * GET /user/json/:userName/atlas?start&length: the Annotations tab, one row
 * per dataset and project the user annotated, that the visitor may see,
 * newest first ({url, name, project, slices, modified})
 */
const api_userAtlas = tabRoute(userAnnotations, 'successful');

// The length of a project's `files.list` or `collaborators.list`, 0 when missing.
// (No `?.`/`??`: the eslint config parses an older ECMAScript.)
const listLength = (part) => (part && Array.isArray(part.list) ? part.list.length : 0);

/**
 * A project of the list as the visitor may see it, with its counts and its
 * last modification date (no `modified` when it is not known)
 * @param {object} project The project document
 * @param {string} loggedUser The visitor
 * @param {Map<string, Date>} annotated shortname → newest annotation
 * @returns {object} The row
 */
const projectRow = (project, loggedUser, annotated) => {
  const { modified: saved, ...rest } = visibleProject(project, loggedUser);
  const modified = lastModified(saved, annotated.get(project.shortname), rest.created);

  return {
    ...rest,
    ...(modified ? { modified } : {}),
    numFiles: listLength(rest.files),
    numCollaborators: listLength(rest.collaborators)
  };
};

/**
 * GET /user/json/:userName/projects?[start][&length]: NWL's userProjectsRoute
 * (1.22.0). The user's current projects (owner, or a collaborator row naming
 * them by userID, username or nickname) that the visitor may see, `length` of
 * them from `start` (by default all of them), as `{successful: true, list}`:
 * each the visible project with its number of files and of visible
 * collaborators, and its last modification date (the later of its last save
 * and its newest annotation, else its creation date; none when none of them
 * is known). An error goes to the app's errorHandler (a 500 `{error}`).
 */
const api_userProjects = userProjectsRoute({
  db: (req) => req.appConfig.db.nativeMongoDB(),
  canView: (req, project) => AccessControlService.canViewFiles(project, visitor(req) || 'anyone'),
  rows: async (req, page) => {
    const annotated = await newestAnnotations(req.appConfig.db.nativeMongoDB(), page.map((project) => project.shortname));
    const loggedUser = visitor(req) || 'anyone';

    return page.map((project) => projectRow(project, loggedUser, annotated));
  },
  answer: (list) => ({ successful: true, list })
});

module.exports = {
  validator,
  api_user,
  api_userAll,
  api_userFiles,
  api_userAtlas,
  api_userProjects,
  user
};
