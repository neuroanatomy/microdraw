var express = require('express');
var controller = require('./data.controller');
var embed = require('../embed/embed.controller');

var router = express.Router(); // eslint-disable-line new-cap

router.get('', controller.data);

// the embeddable, read-only viewer and its layers (T002 3.7)
router.get('/embed', embed.dataEmbed);
router.get('/layers', embed.apiDataLayers);

module.exports = router;
