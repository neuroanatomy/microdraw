/* eslint-disable camelcase */
const { AccessControlService } = require('neuroweblab');
// const async = require('async');
// const dateFormat = require('dateformat');
// const checkAccess = require('../checkAccess/checkAccess.js');
// const dataSlices = require('../dataSlices/dataSlices.js');

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

// Users found by a search go out through the public-field allow-list of
// T004: username and name only (the user page exposes the same fields).
const api_searchUsers = function (req, res) {
  req.appConfig.db.searchUsers({q: req.query.q})
    .then((o) => { res.send(JSON.stringify(o.map(({username, name}) => ({username, name})))); })
    .catch((e) => res.send(e)
      .status(403)
      .end());
};

const maxProjectsFound = 10;

// Projects found by a search are filtered for view access, as BrainBox's
// project lists are, before keeping the first 10.
const api_searchProjects = function (req, res) {
  const loggedUser = req.isAuthenticated() ? req.user.username : 'anyone';
  req.appConfig.db.mongoDB().get('projects')
    .find(
      {shortname: {$regex: req.query.q}, backup: {$exists: false}},
      {fields: {_id: 0, shortname: 1, name: 1, owner: 1, collaborators: 1}}
    )
    .then((projects) => {
      const found = projects
        .filter((p) => AccessControlService.canViewFiles(p, loggedUser))
        .slice(0, maxProjectsFound)
        .map(({shortname, name}) => ({shortname, name}));
      res.send(JSON.stringify(found));
    })
    .catch((e) => res.send(e)
      .status(403)
      .end());
};

module.exports = {
  validator,
  api_searchUsers,
  api_searchProjects
};
