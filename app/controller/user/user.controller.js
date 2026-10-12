/* eslint-disable camelcase */
/* eslint-disable radix */
// const async = require('async');
const dateFormat = require('dateformat');
const { AccessControlService } = require('neuroweblab');
const { scriptJSON } = require('../escape');
const { visibleProjectParts } = require('../project/visibleProject');
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
      console.log('ERROR:', err);
      res.status(400).send('Error');
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
        res.send(json);
      } else {
        res.send();
      }
    })
    .catch((err) => {
      if (err && err.message === 'error find one user') {
        res.status(404).send({error: 'User not found'});
      } else {
        console.log('ERROR:', err);
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
    console.log('ERROR:', err);
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
  const {userName} = req.params;
  const start = parseInt(req.query.start);
  const length = parseInt(req.query.length);

  console.log('userName:', userName, 'start:', start, 'length:', length);
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
  const {userName} = req.params;
  const start = parseInt(req.query.start);
  const length = parseInt(req.query.length);

  console.log('userName:', userName, 'start:', start, 'length:', length);
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
 * Projects of a user that the visitor may view, each with only the parts the
 * visitor may view.
 * @param {object} req Request object
 * @param {object} res Response object
 * @returns {void}
 */
const api_userProjects = function (req, res) {
  const {userName} = req.params;
  // const start = parseInt(req.query.start);
  // const length = parseInt(req.query.length);
  const loggedUser = req.user ? req.user.username : 'anyone';

  req.appConfig.db.queryUserProjects(userName)
    .then((result) => {
      const filteredList = result
        .filter((project) => AccessControlService.canViewFiles(project, loggedUser))
        .map((project) => visibleProjectParts(project, loggedUser));
      res.send({
        successful: true,
        list: filteredList
      });
    })
    .catch((err) => {
      console.log('ERROR:', err);
      res.status(500).send({successful: false, list: []});
    });
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
