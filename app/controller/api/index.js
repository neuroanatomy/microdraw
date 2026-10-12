/* eslint-disable max-lines */
const express = require('express');
const router = new express.Router();
const multer = require('multer');
const { AccessControlService } = require('neuroweblab');
const { catchErrors } = require('../catchErrors');

const fs = require('fs');

const {TMP_DIR} = process.env;
const storage = TMP_DIR
  ? multer.diskStorage({
    destination: TMP_DIR
  })
  : multer.memoryStorage();

const buildFileID = function ({ source, slice }) {
  return `${source}&slice=${slice}`;
};

// API routes

// eslint-disable-next-line max-statements
const getAnnotationsUnsafe = async function (req, res) {
  console.warn("call to GET api");
  console.warn(req.query);

  // current user
  const username = (req.user && req.user.username) || 'anyone';
  console.log(`current user: ${username}`);

  // project name
  const project = (req.query.project) || '';
  console.log(`current project: ${project}`);

  if(project) {
    // project owner and project users
    const result = await req.app.db.queryProject({shortname: project});
    const owner = result
                    && result.owner;
    const users = result
                    && result.collaborators
                    && result.collaborators.list
                    && result.collaborators.list.map((u) => u.username) || [];
    console.log(`project owner: ${owner}, users: ${users}`);

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
  console.log("api get query", query);

  const annotations = await req.app.db.findAnnotations(query, backup);
  console.log(`found ${annotations.length} annotations`);

  res.status(200).send(annotations);
};

// Errors in the annotation routes answer 500 {err: 'Server error'}.
const serverError = (res) => res.status(500).send({err: 'Server error'});

router.get('/', catchErrors(getAnnotationsUnsafe, serverError));

// eslint-disable-next-line max-statements
const updateAnnotation = async (req, {
  fileID,
  user,
  project,
  Hash,
  annotationString
}) => {
  // get new annotations and ID
  const annotation = JSON.parse(annotationString);
  const {Regions: newAnnotations, RegionsToRemove: uidsToRemove} = annotation;

  // get previous annotations
  const prevAnnotations = await req.app.db.findAnnotations({fileID, user, project});

  // update previous annotations with new annotations,
  // overwrite what already exists, remove those marked for removal
  for(const prevAnnot of prevAnnotations) {
    const {uid} = prevAnnot.annotation;
    let foundInPrevious = false;
    for(const newAnnot of newAnnotations) {
      if(newAnnot.uid === uid) {
        foundInPrevious = true;
        break;
      }
    }

    let markedForRemoval = false;
    if(uidsToRemove) {
      for(const uidToRemove of uidsToRemove) {
        if(uid === uidToRemove) {
          markedForRemoval = true;
          break;
        }
      }
    }

    if(!foundInPrevious && !markedForRemoval) {
      newAnnotations.push(prevAnnot.annotation);
    }
  }
  annotation.Regions = newAnnotations;

  // mark previous version as backup
  const query = Object.assign(
    {},
    { fileID, /*user,*/ project }, // update annotations authored by anyone
    { backup: { $exists: false } }
  );
  const update = { $set: { backup: true } };
  const options = { multi: true };

  // add new version
  const arrayTobeSaved = annotation.Regions.map((region) => ({
    fileID,
    user, // "user" property in annotation corresponds to "username" everywhere else
    project,
    Hash,
    annotation: region
  }));
  await req.app.db.updateAnnotations({ query, update, options });
  await req.app.db.insertAnnotations(arrayTobeSaved);
};

// eslint-disable-next-line max-statements
const saveFromGUI = async function (req, res) {
  const { Hash, annotation } = req.body;

  // current user
  const username = (req.user && req.user.username) || 'anyone';
  console.log(`current user: ${username}`);

  // project name
  const project = (req.body.project) || '';
  console.log(`current project: ${project}`);

  // project owner and project users
  if(project) {
    const result = await req.app.db.queryProject({shortname: project});
    const owner = result
        && result.owner;
    const users = result
        && result.collaborators
        && result.collaborators.list
        && result.collaborators.list.map((u) => u.username);
    console.log(`project owner: ${owner}, users: ${users}`);

    if (!result) {
      res.status(404).json({error: 'Project not found'});

      return;
    }

    // check if user has edit permission
    if(!AccessControlService.canEditAnnotations(result, username)) {
      res.status(403).send(`User ${username} does not have permission to edit annotations on project ${project}`);


      return;
    }
  }

  const fileID = buildFileID(req.body);
  updateAnnotation(req, {
    fileID,
    user: username,
    project,
    Hash,
    annotationString: annotation
  })
    .then(() => {
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
  if (typeof project === 'undefined') {
    res.status(401).json({msg: "Invalid project"});
  } else if(!jsonIsValid(json).valid) {
    res.status(401).json({
      msg: `Invalid annotation file: ${jsonIsValid(json).msg}`
    });
  } else if (project && !(await req.app.db.queryProject({shortname: project}))) {
    res.status(404).json({msg: 'Project not found'});
  } else {
    const { action } = req.query;

    let annotations = { Regions: [] };
    if (action === 'append') {
      const oldAnnotations = await req.app.db.findAnnotations({ fileID, user: username, project });
      annotations = {
        Regions: oldAnnotations
      };
    }

    /**
    * use object destruction to avoid mutation of annotations object
    */

    const { Regions, ...rest } = annotations;

    updateAnnotation(req, {
      fileID,
      user: username,
      project,
      Hash,
      annotationString: JSON.stringify({
        ...rest,
        Regions: Regions.concat(json.map((v) => v.annotation))
      })
    })
      .then(() => res.status(200).send({msg: "Annotation successfully saved"}))
      .catch((e) => res.status(500).send({ err: e.message}));
  }
};

const saveFromAPI = catchErrors(saveFromAPIUnsafe, serverError);

router.post('/', catchErrors(async function (req, res) {
  console.warn("call to POST from GUI");

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
  console.warn("call to POST from API");

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

router.use('', (req, res) => res.redirect('/'));

module.exports = router;
