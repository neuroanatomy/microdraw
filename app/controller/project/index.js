const express = require('express');
const { authTokenMiddleware } = require('neuroweblab');
const controller = require('./project.controller');

const router = new express.Router();

router.get('/new', controller.validator, controller.projectNew);

// The JSON routes accept an API token (?token=), as in BrainBox.
router.get('/json', authTokenMiddleware, controller.apiProjectAll);
router.get('/json/:projectName', controller.validator, authTokenMiddleware, controller.apiProject);

router.get('/:projectName', controller.validator, controller.project);
router.get('/:projectName/settings', controller.validator, controller.settings);

router.post('/json/:projectName', controller.validator, authTokenMiddleware, controller.postProject);
router.delete('/json/:projectName', controller.validator, authTokenMiddleware, controller.deleteProject);

module.exports = router;
