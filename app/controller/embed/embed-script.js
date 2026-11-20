/**
 * GET /embed.js: the loader a host page includes to get the embeddable viewer
 * (GET /data/embed) in an iframe kept at the height the viewer asks for.
 *
 * The text is made by nwl-components' embedScript() (the loader BrainBox's
 * /embed.js shares), with microdraw's names, once at start-up. It is served
 * unminified and with its comments: whoever decides whether to trust the
 * script reads it. Third-party pages load it, so its URL, data-* attributes,
 * iframe URL and resize message (microdraw:embed-resize) must not change.
 */
const { embedScript } = require('nwl-components/embed');

const EMBED_JS = embedScript({
  prefix: 'microdraw',
  appName: 'MicroDraw',
  endpoint: '/data/embed',
  required: 'source',
  // data-* attribute (camelCased by dataset) -> /data/embed query parameter
  params: {
    source: 'source',
    project: 'project',
    slice: 'slice',
    maxHeight: 'maxHeight',
    microdrawLink: 'microdrawLink'
  },
  optionsDoc: [
    ['data-source', 'source URL of the dataset          (required)'],
    ['data-project', 'project whose regions are shown'],
    ['data-slice', 'initial slice number'],
    ['data-max-height', 'cap, in px, on the height the viewer may ask for'],
    ['data-microdraw-link', '"0" hides the MicroDraw link']
  ]
});

// a Buffer, so that res.send keeps the Content-Type as written (for a string it
// rewrites the charset as utf-8)
const EMBED_JS_BYTES = Buffer.from(EMBED_JS, 'utf8');

/**
 * Serve the loader with the headers express.static gave the file it replaces
 * (the CORS headers come from the app's middleware, the ETag from res.send)
 * @param {Object} req The request
 * @param {Object} res The response
 * @returns {void}
 */
const embedScriptRoute = function (req, res) {
  res.set('Content-Type', 'application/javascript; charset=UTF-8');
  res.set('Cache-Control', 'public, max-age=0');
  res.send(EMBED_JS_BYTES);
};

module.exports = { EMBED_JS, embedScriptRoute };
