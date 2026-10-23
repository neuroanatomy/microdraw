/* eslint-disable camelcase */
const { AccessControlService } = require('neuroweblab');
const log = require('../../log');
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

// The search text, escaped so that it matches literally: the raw text went
// into a MongoDB $regex, so a crafted one could make the database backtrack
// for a long time (ReDoS), and an invalid one made the query fail. As
// BrainBox's escapeRegex (controller/api/api.controller.js).
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The search text of the request, or undefined (and a 400 answer) if q is
// not a string (e.g. ?q[$ne]=). Not escaped: NeuroWebLab's searchUsers
// escapes it itself (0.2.0), and escaping it twice would make a search for
// "a.b" look for "a\\.b". microdraw's own projects query escapes it.
const searchText = (req, res) => {
  const { q } = req.query;
  if (typeof q !== 'string') {
    res.status(400).json({ error: 'Provide the text to search for in q' });

    return;
  }

  return q;
};

const serverError = (res, err) => {
  log.error({ err }, 'search failed');
  res.status(500).json({ error: 'Server error' });
};

// Users found by a search go out through the public-field allow-list of
// T004: username and name only (the user page exposes the same fields).
const api_searchUsers = function (req, res) {
  const q = searchText(req, res);
  if (typeof q === 'undefined') {
    return;
  }
  req.appConfig.db.searchUsers({q})
    .then((o) => { res.json(o.map(({username, name}) => ({username, name}))); })
    .catch((err) => serverError(res, err));
};

const maxProjectsFound = 10;

// Projects found by a search are filtered for view access, as BrainBox's
// project lists are, before keeping the first 10.
const api_searchProjects = function (req, res) {
  const q = searchText(req, res);
  if (typeof q === 'undefined') {
    return;
  }
  const loggedUser = req.isAuthenticated() ? req.user.username : 'anyone';
  req.appConfig.db.mongoDB().get('projects')
    .find(
      {shortname: {$regex: escapeRegex(q)}, backup: {$exists: false}},
      {fields: {_id: 0, shortname: 1, name: 1, owner: 1, collaborators: 1}}
    )
    .then((projects) => {
      const found = projects
        .filter((p) => AccessControlService.canViewFiles(p, loggedUser))
        .slice(0, maxProjectsFound)
        .map(({shortname, name}) => ({shortname, name}));
      res.json(found);
    })
    .catch((err) => serverError(res, err));
};

module.exports = {
  escapeRegex,
  validator,
  api_searchUsers,
  api_searchProjects
};
