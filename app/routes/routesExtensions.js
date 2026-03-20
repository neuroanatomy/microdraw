const url = require('url');
const http = require('http');
const https = require('https');

/**
 * Make an HTTP(S) GET request and return a Promise resolving to { res, body }.
 * @param {string} requestUrl The URL to fetch
 * @returns {Promise<{res: object, body: string}>} The response and body
 */
const httpGet = (requestUrl) => new Promise((resolve, reject) => {
  const client = requestUrl.startsWith('https') ? https : http;
  client.get(requestUrl, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ res, body: Buffer.concat(chunks).toString() }));
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
      .then(({ res: proxyRes, body }) => {
        res.status(proxyRes.statusCode);
        if(proxyRes.headers['content-type']) {
          res.set('content-type', proxyRes.headers['content-type']);
        }
        res.end(body);
      })
      .catch((err) => {
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
    const sourceHostname =
                (new RegExp('^http')).test(source) ?
                  url.parse(source).protocol + '//' + url.parse(source).host :
                  req.protocol + '://' + req.get('host');
    const sourcePath = url.parse(source).path ? url.parse(source).path : null;

    try {
      if( !sourceHostname || !sourcePath ) {
        throw new Error('ERROR: sourceurl not defined');
      }

      const { res: proxyRes, body } = await httpGet(sourceHostname + sourcePath);

      if ((/error/).test(sourcePath)) {
        console.log({body, proxyRes});
      }

      if(proxyRes.statusCode >= 400) {
        throw body;
      }

      const json = JSON.parse(body);
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

        console.log(tileSource);

        return tileSource;
      });
      res.status(200).send(JSON.stringify(json));
    } catch (e) {
      console.log("13");
      console.log('Error at /getJson', e);
      res.status(404).send(e);
    }
  });
};
