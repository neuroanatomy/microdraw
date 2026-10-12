const express = require('express');
const { authTokenMiddleware } = require('neuroweblab');
const controller = require('./admin.controller');
const router = new express.Router();

// Route names follow BrainBox controller/admin/index.js. Admins only: the page
// asks anonymous visitors to log in (401) and answers 403 to other users; the
// JSON routes answer 401/403. A valid API token (?token=) counts as a login.
router.get('', authTokenMiddleware, controller.adminPage);
router.get('/json/orphans', authTokenMiddleware, controller.requireAdmin, controller.getOrphans);
router.get('/json/orphans/projects', authTokenMiddleware, controller.requireAdmin, controller.getOrphanProjects);
router.post('/json/orphans/remove', authTokenMiddleware, controller.requireAdmin, controller.removeOrphans);
router.post('/json/orphans/restore', authTokenMiddleware, controller.requireAdmin, controller.restoreOrphans);
router.post('/json/orphans/assign', authTokenMiddleware, controller.requireAdmin, controller.assignOrphans);
router.get('/json/projects/invalid', authTokenMiddleware, controller.requireAdmin, controller.getInvalidProjects);
router.post('/json/projects/remove-blank-rows', authTokenMiddleware, controller.requireAdmin, controller.removeBlankRows);
router.post('/json/projects/name-layers', authTokenMiddleware, controller.requireAdmin, controller.nameLayers);
router.post('/json/projects/restore', authTokenMiddleware, controller.requireAdmin, controller.restoreProject);

module.exports = router;
