const log = require('../log');
const { relayedType, inertHeaders, sendFailure } = require('../routes/relayed');
// only public addresses, each redirect checked again, with size and time limits (S1a)
const { fetchPublic } = require('../routes/publicFetch');

// as before S1a: up to 5 redirects
const MAX_REDIRECTS = 5;

const getHttpImg = function (req, res) {
  const { url } = req.query;
  fetchPublic(String(url || ''), MAX_REDIRECTS)
    .then((response) => {
      const contentType = response.headers['content-type'] || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': relayedType(contentType), ...inertHeaders() });
      res.end(response.body, 'binary');
    })
    .catch((err) => {
      log.error({ err, url }, 'cannot fetch remote image');
      sendFailure(res, err);
    });
};

exports.getHttpImg = getHttpImg;
