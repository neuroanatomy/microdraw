'use strict';

/**
 * The full toolbar's frame (T002 K2b): nwl-components' toolsFrame (3.9.0), shared with
 * BrainBox, holding microdraw's slider and buttons. Those stay microdraw's own templates
 * (views/partials/toolsSlider.mustache and toolsButtons.mustache), rendered to strings with the
 * app's mustache engine and put in the frame's slots; the result goes in toolsFull.mustache
 * with triple braces. It holds only the library's markup and those templates, never user data:
 * keep it that way (no request values in the slots).
 */

const { promisify } = require('util');
const { toolsFrame } = require('nwl-components/chat');

// the icons as app.js serves nwl-components' dist folder
const iconUrl = (name) => `/lib/nwl-components/icons/${name}.svg`;

/**
 * @param {object} app The express app, with its mustache view engine set
 * @returns {Promise<string>} The frame's HTML: #tools-side
 */
const renderToolsFrame = async (app) => {
  const render = promisify(app.render.bind(app));
  const [slider, buttons] = await Promise.all([
    render('partials/toolsSlider', {}),
    render('partials/toolsButtons', {})
  ]);

  return toolsFrame({ iconUrl, slider, buttons, sliceNumber: true });
};

module.exports = { renderToolsFrame, iconUrl };
