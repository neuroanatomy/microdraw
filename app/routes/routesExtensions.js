const http = require('http');
const https = require('https');
const log = require('../log');

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

    if( !source ) {
      return res.status(404).send('source must be defined');
    }

    httpGet(source)
      .then(({ statusCode, headers, body }) => {
        res.status(statusCode);
        if(headers['content-type']) {
          res.set('content-type', headers['content-type']);
        }
        res.end(body);
      })
      .catch((err) => {
        (req.log || log).warn({ err, source }, 'cannot fetch tile');
        res.status(500).send(err.message);
      });
  });

  // eslint-disable-next-line max-statements
  app.get('/getJson', async function (req, res) {
    const { source } = req.query;

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

      const { statusCode, body } = await httpGet(sourceHostname + sourcePath);

      if(statusCode >= 400) {
        throw body.toString();
      }

      const json = JSON.parse(body.toString());
      json.tileSources = json.tileSources.map((result) => {
        let tileSource = result;
        if(typeof result === 'string') {
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
      res.status(200).send(JSON.stringify(json));
    } catch (e) {
      (req.log || log).warn({ err: e, source }, 'cannot get the tile source JSON');
      res.status(404).send(e);
    }
  });
};
