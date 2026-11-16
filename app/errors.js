'use strict';

// The 404 catch-all and the error handler, from NeuroWebLab (1.13.0), as
// app.js uses them after the routes.
const { notFound, errorHandler } = require('neuroweblab');

module.exports = {
  // Nothing matched: answer 404 in the form the request expects, never
  // Express's bare "Cannot GET": {"error":"Not found"}, the error page, or
  // plain text. The request log line records the 404; nothing more is logged
  // (bots probe a lot of URLs).
  notFound: notFound(),

  // JSON {error} for a JSON request, else the error page; a 5xx message is
  // "Server error" outside development. The error is logged with the request
  // line (pino-http reads res.err), for every status.
  errorHandler: errorHandler({ onError: (err, req, res) => { res.err = err; } })
};
