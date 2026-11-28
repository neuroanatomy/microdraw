const http = require('http');
const https = require('https');
const log = require('../log');
const { relayedType, inertHeaders } = require('./relayed');
// the pages' reading of what an address names: a JSON list or one image
const { isZarrURL, isCziURL, parseDataset } = require('../public/js/page-helpers');

/**
 * Make an HTTP(S) GET request, returning the response metadata and body as a Buffer.
 * @param {string} requestUrl The URL to fetch
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>} The response
 */
const httpGet = (requestUrl) => new Promise((resolve, reject) => {
  const isHttps = requestUrl.startsWith('https');
  const client = isHttps ? https : http;
  const args = isHttps ? [requestUrl, { rejectUnauthorized: false }] : [requestUrl];
  client.get(...args, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({
      statusCode: res.statusCode,
      headers: res.headers,
      body: Buffer.concat(chunks)
    }));
    res.on('error', reject);
  }).on('error', reject);
});

module.exports = (app) => {
  app.get('/getTile', function (req, res) {
    const { source } = req.query;
    res.set(inertHeaders());

    if( !source ) {
      return res.status(404).send('source must be defined');
    }

    httpGet(source)
      .then(({ statusCode, headers, body }) => {
        res.status(statusCode);
        // setHeader: res.set would add a charset to the other server's type
        res.setHeader('content-type', relayedType(headers['content-type']));
        res.end(body);
      })
      .catch((err) => {
        (req.log || log).warn({ err, source }, 'cannot fetch tile');
        res.status(500).type('text/plain')
          .send(err.message);
      });
  });

  // eslint-disable-next-line max-statements
  app.get('/getJson', async function (req, res) {
    const { source } = req.query;
    res.set(inertHeaders());
    // a string is otherwise sent as HTML
    const sendJson = (value) => res.status(200).type('application/json')
      .send(JSON.stringify(value));

    if( !source ) {
      return res.status(404).send('source must be defined');
    }

    const thisHostname = req.protocol + '://' + req.get('host');
    let sourceHostname;
    let sourcePath;

    try {
      // A relative source is resolved against this server
      const target = new URL(source, thisHostname);
      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('ERROR: sourceurl must be http or https');
      }
      sourceHostname = target.protocol + '//' + target.host;
      sourcePath = target.pathname + target.search;

      // what a single image is called in the answer: the browser loads it itself,
      // so a path on this server stays a path
      const address = target.host === req.get('host') && source.startsWith('/') ? source : target.href;

      // an OME-Zarr store is a folder: there is no description to fetch
      if (isZarrURL(address)) {
        return sendJson({ tileSources: [{ type: 'ome-zarr', url: address }] });
      }

      // nor is a CZI file, which is gigabytes: the viewer asks the CZI service
      if (isCziURL(address)) {
        return sendJson({ tileSources: [address] });
      }

      const { statusCode, body } = await httpGet(sourceHostname + sourcePath);

      if(statusCode >= 400) {
        throw body.toString();
      }

      const text = body.toString();
      const json = parseDataset(text, address);
      // one DeepZoom image (XML, not a JSON list): nothing to rewrite
      if (text.trim().startsWith('<')) {
        return sendJson(json);
      }
      json.tileSources = json.tileSources.map((result) => {
        let tileSource = result;
        if(typeof result === 'string' && (isZarrURL(result) || isCziURL(result))) {
          // neither a store's files nor a CZI file can go through /getTile
          tileSource = new URL(result, sourceHostname + '/').href;
        } else if(typeof result === 'string') {
          if((new RegExp('^http')).test(tileSource) === false) {
            if(tileSource[0] === '/') {
              tileSource = thisHostname + '/getTile?source=' + sourceHostname + tileSource;
            } else {
              tileSource = thisHostname + '/getTile?source=' + sourceHostname + '/' + tileSource;
            }
          }
        }

        return tileSource;
      });
      sendJson(json);
    } catch (e) {
      (req.log || log).warn({ err: e, source }, 'cannot get the tile source JSON');
      // a string is what the other server answered
      if (typeof e === 'string') {
        res.status(404).type('text/plain')
          .send(e);
      } else {
        res.status(404).send(e);
      }
    }
  });
};
