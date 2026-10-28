/* eslint-disable camelcase */
/* eslint-disable radix */
// const async = require('async');
const dateFormat = require('dateformat');
const log = require('../../log');
const { AccessControlService } = require('neuroweblab');
const { scriptJSON } = require('../escape');
const { visibleProjectParts } = require('../project/visibleProject');
const { lastModified, newestAnnotations } = require('./lastModified');
//const checkAccess = require('../checkAccess/checkAccess.js');
//const dataSlices = require('../dataSlices/dataSlices.js');

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

// Fields of a user document that the public user routes may expose
// (GET /user/json/:userName and the userInfo of GET /user/:userName).
// Never passhash, tokens, or anything else stored on the user.
const publicUserFields = ['username', 'name', 'avatarURL', 'url', 'joined'];

const publicUser = (doc) => {
  const pub = {};
  for (const field of publicUserFields) {
    if (typeof doc[field] !== 'undefined') {
      pub[field] = doc[field];
    }
  }

  return pub;
};

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
          userInfo: scriptJSON(publicUser(json)),
          tab: req.query.tab || 'data',
          loggedUser: scriptJSON(req.user || null)
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

// Lists usernames, 20 per page, as BrainBox's apiUserAll lists nicknames.
// Queried here: NWL's db.js does not export queryAllUsers (T001 step 2).
const api_userAll = async function (req, res) {
  if (!req.query.page) {
    res.json({error: 'The \'pages\' parameter has to be specified'});

    return;
  }

  const page = Math.max(0, parseInt(req.query.page) || 0);
  const nItemsPerPage = 20;

  try {
    const users = await req.appConfig.db.mongoDB().get('users')
      .find({backup: {$exists: false}, username: {$type: 'string'}}, {skip: page * nItemsPerPage, limit: nItemsPerPage, fields: {_id: 0, username: 1}});
    res.send(users.map((o) => o.username));
  } catch (err) {
    log.error({ err }, 'cannot list users');
    res.status(500).json({error: 'Server error'});
  }
};


/**
 * @todo Check access rights for this route
 */

/**
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const api_userFiles = function (req, res) {
  // Not implemented yet (T002 stage 3.3, 3.4): an empty list, not fake rows.
  res.send({
    success: true,
    list: []
  });

  /*
    dataSlices.getUserFilesSlice(req, userName, start, length)
    .then(result => {
        res.send(result);
    })
    .catch(err => {
        console.log('ERROR:', err);
        res.send({success: false, list: []});
    });
    */
};

/**
 * @todo Check access rights for this route
 */

/**
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const api_userAtlas = function (req, res) {
  // Not implemented yet (T002 stage 3.4): an empty list, not fake rows.
  res.send({
    successful: true,
    list: []
  });

  /*
    dataSlices.getUserAtlasSlice(req, userName, start, length)
    .then(result => {
        res.send(result);
    })
    .catch(err => {
        console.log('ERROR:', err);
        res.send({success: false, list: []});
    });
    */
};

/**
 * A non-negative integer query parameter, or `fallback` when it is missing or not one.
 * @param {string} value The query value
 * @param {number} fallback The default
 * @returns {number} The integer
 */
const queryInt = (value, fallback) => {
  const n = Number(value);

  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

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
  const { modified: saved, ...rest } = visibleProjectParts(project, loggedUser);
  const modified = lastModified(saved, annotated.get(project.shortname), rest.created);

  return {
    ...rest,
    ...(modified ? { modified } : {}),
    numFiles: listLength(rest.files),
    numCollaborators: listLength(rest.collaborators)
  };
};

// The page of the user's projects that the visitor may see, and the visitor
const userProjectsPage = async (req) => {
  const start = queryInt(req.query.start, 0);
  const length = queryInt(req.query.length, Infinity);
  const loggedUser = req.user ? req.user.username : 'anyone';
  const result = await req.appConfig.db.queryUserProjects(req.params.userName);
  const page = result
    .filter((project) => AccessControlService.canViewFiles(project, loggedUser))
    .slice(start, start + length);

  return { page, loggedUser };
};

/**
 * The projects of a user that the visitor may see, `length` of them from
 * `start` (query parameters; by default all of them), each with its number of
 * files and of visible collaborators, and its last modification date (the
 * later of its last save and its newest annotation, else its creation date;
 * none when none of them is known).
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const api_userProjects = async function (req, res) {
  try {
    const { page, loggedUser } = await userProjectsPage(req);
    const annotated = await newestAnnotations(req.appConfig.db.mongoDB(), page.map((project) => project.shortname));
    res.send({
      successful: true,
      list: page.map((project) => projectRow(project, loggedUser, annotated))
    });
  } catch (err) {
    log.error({ err, profile: req.params.userName }, 'user request failed');
    res.status(500).send({successful: false, list: []});
  }
};

module.exports = {
  validator,
  api_user,
  api_userAll,
  api_userFiles,
  api_userAtlas,
  api_userProjects,
  user
};
