/**
 * The embeddable, read-only viewer (T002 3.7), on the model of BrainBox's
 * GET /mri/embed and GET /mri/layers (controller/mri/mri.controller.js):
 * - GET /data/embed?source&project&slice&maxHeight&microdrawLink: a
 *   chromeless viewer of one dataset, always read-only, framable by any site
 *   (Content-Security-Policy: frame-ancestors *, on this route only);
 * - GET /data/layers?source: the projects whose annotations an embedding
 *   page may show for a dataset, behind the same check;
 * - GET /project/:projectName/embed: what nwl-components' "Embed Project"
 *   button frames, the embed of the project's first dataset.
 */
const _ = require('lodash');
const { catchErrors, jsonForScript } = require('neuroweblab');
const { findCurrentProject } = require('../project/currentProject');
const { mayEmbedData, embedLayers } = require('./embed-access');
const EmbedAccessService = require('./EmbedAccessService');

// The query parameters the embed reads, and the only ones reflected into the
// page (as BrainBox's EMBED_QUERY_PARAMS)
const EMBED_QUERY_PARAMS = ['source', 'project', 'slice', 'maxHeight', 'microdrawLink'];

const usernameOf = (req) => (req.isAuthenticated && req.isAuthenticated() ? req.user.username : 'anyone');

/**
 * The parameters reflected into the page: the known ones, strings only
 * @param {Object} query The request's query
 * @returns {Object} The parameters
 */
const embedParams = (query) => _.pickBy(_.pick(query, EMBED_QUERY_PARAMS), (v) => typeof v === 'string');

const embedError = (res, status, message) => {
  res.status(status);
  res.render('embedError', { message });
};

const embedServerError = (res) => embedError(res, 500, 'This dataset could not be loaded.');

/**
 * @function dataEmbed
 * @desc The chromeless, read-only viewer of one dataset
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @returns {Promise<void>} Once answered
 */
// eslint-disable-next-line max-statements
const dataEmbedUnsafe = async function (req, res) {
  // This route exists to be framed by other sites: say so explicitly
  res.set('Content-Security-Policy', 'frame-ancestors *');

  const { source, project } = req.query;
  if (typeof source !== 'string' || source.length === 0) {
    embedError(res, 400, 'No dataset was requested.');

    return;
  }
  if (typeof project !== 'undefined' && typeof project !== 'string') {
    embedError(res, 400, 'Ask for one project.');

    return;
  }

  const db = req.app.db.nativeMongoDB();
  const username = usernameOf(req);
  const decision = await mayEmbedData(db, { source, project, username });
  if (decision.status !== 200) {
    embedError(res, decision.status, decision.message);

    return;
  }

  const embedWsTicket = await EmbedAccessService.mintWsTicket(db, {
    source,
    project: decision.project ? decision.project.shortname : null,
    username: username === 'anyone' ? null : username
  });

  res.render('dataEmbed', {
    title: decision.project && decision.project.name ? `${decision.project.name}: MicroDraw` : 'MicroDraw',
    params: jsonForScript(embedParams(req.query)),
    embedWsTicket: jsonForScript(embedWsTicket),
    wsPort: req.app.get('wsPort') || 8080
  });
};

/**
 * @function apiDataLayers
 * @desc {layers: [{project, name, access}]}: the projects listing a source
 *       whose annotations the visitor may view
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @returns {Promise<void>} Once answered
 */
const apiDataLayersUnsafe = async function (req, res) {
  const { source } = req.query;
  if (typeof source !== 'string' || source.length === 0) {
    res.status(400).json({ error: 'No dataset was requested' });

    return;
  }
  const answer = await embedLayers(req.app.db.nativeMongoDB(), { source, username: usernameOf(req) });
  if (answer.status !== 200) {
    res.status(answer.status).json({ error: answer.message });

    return;
  }
  res.status(200).json({ layers: answer.layers });
};

/**
 * @function projectEmbed
 * @desc What the "Embed Project" button of the project settings frames
 *       (nwl-components' ProjectInfo.vue: /project/:shortname/embed): the
 *       embed of the project's first dataset. A project the visitor may not
 *       view, or without datasets, gets the embed error page, and no URL.
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @returns {Promise<void>} Once answered
 */
// eslint-disable-next-line max-statements
const projectEmbedUnsafe = async function (req, res) {
  res.set('Content-Security-Policy', 'frame-ancestors *');
  const db = req.app.db.nativeMongoDB();
  const found = await findCurrentProject(db, req.params.projectName);
  if (!found) {
    embedError(res, 404, 'This project could not be found.');

    return;
  }
  const list = (found.files && Array.isArray(found.files.list)) ? found.files.list : [];
  const first = list.map((f) => (typeof f === 'string' ? f : f && f.source)).find((s) => typeof s === 'string' && s.length > 0);
  const decision = first ?
    await mayEmbedData(db, { source: first, project: found.shortname, username: usernameOf(req) }) :
    { status: 404, message: 'This project has no dataset.' };
  if (decision.status !== 200) {
    embedError(res, decision.status, decision.message);

    return;
  }
  const query = new URLSearchParams({ source: first, project: found.shortname });
  res.redirect(302, `/data/embed?${query.toString()}`);
};

module.exports = {
  EMBED_QUERY_PARAMS,
  dataEmbed: catchErrors(dataEmbedUnsafe, embedServerError),
  apiDataLayers: catchErrors(apiDataLayersUnsafe),
  projectEmbed: catchErrors(projectEmbedUnsafe, embedServerError)
};
