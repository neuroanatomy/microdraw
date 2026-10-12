const express = require('express');
const { authTokenMiddleware } = require('neuroweblab');
const controller = require('./admin.controller');
const router = new express.Router();

// Route names follow BrainBox controller/admin/index.js. Admins only: the
// JSON routes answer 401 to anonymous visitors and 403 to other users. A valid
// API token (?token=) counts as a login.
router.get('/json/orphans', authTokenMiddleware, controller.requireAdmin, controller.getOrphans);
router.get('/json/orphans/projects', authTokenMiddleware, controller.requireAdmin, controller.getOrphanProjects);
router.post('/json/orphans/remove', authTokenMiddleware, controller.requireAdmin, controller.removeOrphans);
router.post('/json/orphans/restore', authTokenMiddleware, controller.requireAdmin, controller.restoreOrphans);
router.post('/json/orphans/assign', authTokenMiddleware, controller.requireAdmin, controller.assignOrphans);

module.exports = router;
