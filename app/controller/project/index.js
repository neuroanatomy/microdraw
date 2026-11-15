const express = require('express');
const { authTokenMiddleware } = require('neuroweblab');
const controller = require('./project.controller');
const embed = require('../embed/embed.controller');

const router = new express.Router();

router.get('/new', controller.validator, controller.projectNew);

// The JSON routes accept an API token (?token=), as in BrainBox.
router.get('/json', authTokenMiddleware, controller.apiProjectAll);
router.get('/json/:projectName', controller.validator, authTokenMiddleware, controller.apiProject);
router.get('/json/:projectName/files', controller.validator, authTokenMiddleware, controller.apiProjectFiles);
router.get('/json/:projectName/text-annotations', controller.validator, authTokenMiddleware, controller.apiTextAnnotations);

router.get('/:projectName', controller.validator, controller.project);
router.get('/:projectName/settings', controller.validator, controller.settings);
// what the settings' "Embed Project" button frames (T002 3.7)
router.get('/:projectName/embed', controller.validator, embed.projectEmbed);

router.post('/json/:projectName', controller.validator, authTokenMiddleware, controller.postProject);
router.delete('/json/:projectName', controller.validator, authTokenMiddleware, controller.deleteProject);

module.exports = router;
