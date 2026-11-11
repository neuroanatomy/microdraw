/* eslint-disable max-lines */
const express = require('express');
const router = new express.Router();
const multer = require('multer');
const { AccessControlService } = require('neuroweblab');
const { catchErrors } = require('../catchErrors');
const { saveEditorChanges } = require('./editorSave');
const { textWriteError, storeTextValue } = require('../textAnnotations');
const { findCurrentProject } = require('../project/currentProject');
const microdrawWebsocketServer = require('../microdrawWebsocketServer/microdrawWebsocketServer');

const fs = require('fs');
const log = require('../../log');

const {TMP_DIR} = process.env;
const storage = TMP_DIR
  ? multer.diskStorage({
    destination: TMP_DIR
  })
  : multer.memoryStorage();

const buildFileID = function ({ source, slice }) {
  return `${source}&slice=${slice}`;
};

// After a save of an image slice is stored, tell the other viewers of the
// slice (live-update notices, step 3a). The saver's own connection is not
// known here, so it gets the notice too. A notice never fails a save.
const notifySaved = ({ project, source, slice }) => {
  try {
    microdrawWebsocketServer.notifySaved({ project, source, slice });
  } catch (err) {
    log.error({ err }, 'cannot notify the viewers of the slice');
  }
};

// API routes

// eslint-disable-next-line max-statements
const getAnnotationsUnsafe = async function (req, res) {
  // current user
  const username = (req.user && req.user.username) || 'anyone';

  // project name
  const project = (req.query.project) || '';

  if(project) {
    const result = await findCurrentProject(req.app.db.nativeMongoDB(), project);
    if (!result) {
      res.status(404).json({error: 'Project not found'});

      return;
    }

    // check if user has view permission
    if(!AccessControlService.canViewAnnotations(result, username)) {
      res.status(403).send(`User ${username} does not have permission to view annotations on project ${project}`);

      return;
    }
  }

  // include backups
  const backup = typeof req.query.backup !== "undefined";

  const query = {
    fileID: buildFileID(req.query),
    // user: { $in: [...users, username] },
    project: project
  };
  log.debug({ user: username, query }, 'get annotations');

  const annotations = await req.app.db.findAnnotations(query, backup);
  log.debug({ count: annotations.length }, 'annotations found');

  res.status(200).send(annotations);
};

// Errors in the annotation routes answer 500 {err: 'Server error'}.
const serverError = (res) => res.status(500).send({err: 'Server error'});

router.get('/', catchErrors(getAnnotationsUnsafe, serverError));

// What the current user (or 'anyone' when logged out) may do with a project's
// annotations, and, with ?source=, whether the project lists that image (as the
// project page matches it: same `source` string). The viewer asks before
// offering to import annotations kept in the browser (H3a): only into a project
// the user can edit and that lists the image.
// eslint-disable-next-line max-statements
const getAnnotationPermissionsUnsafe = async function (req, res) {
  const { project, source } = req.query;
  if (!project || typeof project !== 'string') {
    res.status(400).json({error: 'Missing project'});

    return;
  }
  const result = await findCurrentProject(req.app.db.nativeMongoDB(), project);
  if (!result) {
    res.status(404).json({error: 'Project not found'});

    return;
  }
  const username = (req.user && req.user.username) || 'anyone';
  const answer = {
    project,
    annotations: {
      view: Boolean(AccessControlService.canViewAnnotations(result, username)),
      edit: Boolean(AccessControlService.canEditAnnotations(result, username))
    }
  };
  if (typeof source === 'string') {
    const files = (result.files && Array.isArray(result.files.list)) ? result.files.list : [];
    answer.image = { source, listed: files.some((f) => f && f.source === source) };
  }
  res.status(200).json(answer);
};

router.get('/permissions', catchErrors(getAnnotationPermissionsUnsafe));

// The API upload (POST /api/upload, maintainer 2026-11-09) stores the uploaded
// regions under the uploader's name. `save` first marks the uploader's own
// current regions on the slice as backup (it replaces them); `append` marks
// nothing (it adds to them). Neither touches other users' regions on the slice.
// Backup before insert, as before: the inserted regions must not be backed up.
// The editor save (POST /api) uses editorSave.js.
const storeUpload = async (req, {
  action,
  fileID,
  user,
  project,
  Hash,
  regions
}) => {
  if (action === 'save') {
    await req.app.db.updateAnnotations({
      query: { fileID, user, project, backup: { $exists: false } },
      update: { $set: { backup: true } },
      options: { multi: true }
    });
  }
  await req.app.db.insertAnnotations(regions.map((region) => ({
    fileID,
    user, // "user" property in annotation corresponds to "username" everywhere else
    project,
    Hash,
    annotation: region
  })));
};

// H3b: annotations are only saved inside a project. A save, append or upload
// with an empty or missing project answers 400: the request lacks a required
// parameter, and no user may make it (403 would suggest another user could).
// Before H3b such saves were stored with project '', and each one marked every
// user's '' annotations on the image as backups. Those stay readable (GET /api).
const NO_PROJECT_ERROR = 'Saving annotations requires a project: open the image from a project you can edit, '
  + 'or create one at /project/new';

// Why `username` may not edit annotations in `project`: {status, error}, or
// undefined when it may. Shared by the editor save (POST /api) and the API
// upload (POST /api/upload, H2a).
const annotationEditRefusal = async (req, project, username) => {
  if (!project) {
    return {status: 400, error: NO_PROJECT_ERROR};
  }
  const result = await findCurrentProject(req.app.db.nativeMongoDB(), project);
  if (!result) {
    return {status: 404, error: 'Project not found'};
  }
  if (!AccessControlService.canEditAnnotations(result, username)) {
    return {
      status: 403,
      error: `User ${username} does not have permission to edit annotations on project ${project}`
    };
  }
};

// eslint-disable-next-line max-statements
const saveFromGUI = async function (req, res) {
  const { Hash, annotation } = req.body;

  // H3b (maintainer, 2026-10-12): no logged-out saves, even in a project where
  // 'anyone' may edit. Checked before the project. A valid token sets req.user.
  if (!req.user || !req.user.username) {
    res.status(401).json({error: 'Log in to save annotations'});

    return;
  }

  // current user
  const { username } = req.user;

  // project name
  const project = (req.body.project) || '';

  const refusal = await annotationEditRefusal(req, project, username);
  if (refusal) {
    if (refusal.status === 404 || refusal.status === 400) {
      res.status(refusal.status).json({error: refusal.error});
    } else {
      res.status(refusal.status).send(refusal.error);
    }

    return;
  }

  // only this save's changes, region by region (editorSave.js); the API
  // upload below uses storeUpload
  const fileID = buildFileID(req.body);
  saveEditorChanges(req, {
    fileID,
    user: username,
    project,
    Hash,
    annotationString: annotation
  })
    .then(() => {
      notifySaved({ project, source: req.body.source, slice: req.body.slice });
      res.status(200).send({success: true});
    })
    .catch((e) => {
      res.status(500).send({err:e.message});
    });
};

/**
 * Tests if an object is a valid annotation.
 * @param {object} obj An annotation object to validate.
 * @returns {boolean} True if the object is valid
 */
// eslint-disable-next-line max-statements
const jsonIsValid = function (obj) {
  if(typeof obj === 'undefined') {
    return {valid:false, msg: "json object undefined"};
  }

  if(obj.constructor !== Array) {
    return {valid: false, msg: "json object is not an array"};
  }

  if(!obj.every((item) => item.annotation)) {
    return {valid: false, msg: "items do not have an `annotation` property"};
  }
  if(!obj.every((item) => item.annotation.path)) {
    return {valid: false, msg: "items do not have a `path` property"};
  }
  if(!obj.every((item) => item.annotation.name)) {
    return {valid: false, msg: "items do not have a `name` property"};
  }
  if(!obj.every((item) => item.annotation.uid)) {
    return {valid: false, msg: "items do not have a `uid` property"};
  }

  return {valid: true};
};

/**
 * Loads a json file containing an annotation object.
 * Not used anymore
 * @param {string} annotationPath Path to json file containing an annotation
 * @returns {object} A valid annotation object or nothing.
 */
// const loadAnnotationFile = function (annotationPath) {
//   const json = JSON.parse(fs.readFileSync(annotationPath).toString());
//   if(jsonIsValid(json) === true) {
//     return json;
//   }
// };

// The parsed JSON of the uploaded annotation file, or undefined if there is
// no file or it is not JSON.
const readUploadedJSON = async (req) => {
  const [file] = req.files || [];
  if (!file) {
    return;
  }
  const rawString = TMP_DIR
    ? (await fs.promises.readFile(file.path)).toString()
    : file.buffer.toString();
  try {
    return JSON.parse(rawString);
  } catch (err) {
    // not JSON: answered with 400 by the caller
  }
};

// eslint-disable-next-line max-statements, complexity
const saveFromAPIUnsafe = async function (req, res) {
  const fileID = buildFileID(req.query);
  const username = req.user && req.user.username;
  const { project, Hash } = req.query;
  const json = await readUploadedJSON(req);
  let refusal;
  if (typeof json === 'undefined' || json === null) {
    res.status(400).json({msg: 'Invalid annotation file: no file, or not JSON'});

    return;
  }

  // add uid to path (items without an annotation object fail validation below)
  if (Array.isArray(json)) {
    json.forEach((v) => {
      if (v && v.annotation && typeof v.annotation === 'object') {
        v.annotation.uid = Math.random().toString(16)
          .slice(2);
      }
    });
  }

  // validate and submit
  if (!project) {
    res.status(400).json({msg: NO_PROJECT_ERROR});
  } else if(!jsonIsValid(json).valid) {
    res.status(401).json({
      msg: `Invalid annotation file: ${jsonIsValid(json).msg}`
    });
  } else if ((refusal = await annotationEditRefusal(req, project, username))) {
    res.status(refusal.status).json({msg: refusal.error});
  } else {
    storeUpload(req, {
      action: req.query.action,
      fileID,
      user: username,
      project,
      Hash,
      regions: json.map((v) => v.annotation)
    })
      .then(() => {
        notifySaved({ project, source: req.query.source, slice: req.query.slice });
        res.status(200).send({msg: "Annotation successfully saved"});
      })
      .catch((e) => res.status(500).send({ err: e.message}));
  }
};

const saveFromAPI = catchErrors(saveFromAPIUnsafe, serverError);

router.post('/', catchErrors(async function (req, res) {
  if(req.body.action === 'save') {
    await saveFromGUI(req, res);
  } else {
    res.status(500).send({err:'actions other than save are no longer supported.'});
  }
}, serverError));

const filterAuthorizedUserOnly = (req, res, next) => {
  const username = req.user && req.user.username;
  if (typeof username === 'undefined') {
    return res.status(401).send({msg:'Invalid user'});
  }

  return next();

};

router.post('/upload', filterAuthorizedUserOnly, multer({ storage }).array('data'), function (req, res) {
  const { action } = req.query;
  switch(action) {
  case 'save':
  case 'append':
    saveFromAPI(req, res);
    break;
  default:
    return res.status(500).send({err: `actions other than save and append are no longer supported`});
  }
});

// The value of a named text layer for one file of a project (text layers step
// 2, textAnnotations.js). Logged in (session or token) as the saves; the edit
// rule is the region saves' (annotationEditRefusal, H2a).
// eslint-disable-next-line max-statements
const saveTextAnnotationUnsafe = async function (req, res) {
  if (!req.user || !req.user.username) {
    res.status(401).json({error: 'Log in to save annotations'});

    return;
  }
  const { username } = req.user;
  const { project, source, layer, value } = req.body || {};
  // a string, so that it cannot be a query operator
  if (typeof project !== 'string' || project === '') {
    res.status(400).json({error: NO_PROJECT_ERROR});

    return;
  }
  const refusal = await annotationEditRefusal(req, project, username);
  if (refusal) {
    res.status(refusal.status).json({error: refusal.error});

    return;
  }
  const stored = await findCurrentProject(req.app.db.nativeMongoDB(), project);
  if (!stored) {
    // deleted since the check above
    res.status(404).json({error: 'Project not found'});

    return;
  }
  const error = textWriteError(stored, { source, layer, value });
  if (error) {
    res.status(400).json({error});

    return;
  }
  res.status(200).json(await storeTextValue(req.app.db.nativeMongoDB(), { project, source, layer, value, user: username }));
};

router.post('/text-annotation', catchErrors(saveTextAnnotationUnsafe));

router.use('', (req, res) => res.redirect('/'));

module.exports = router;
