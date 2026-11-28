const log = require('../log');
const { relayedType, inertHeaders, sendText, sendFailure } = require('./relayed');
// only public addresses, with size and time limits (S1a)
const { fetchPublic, fetchOwn } = require('./publicFetch');
// the pages' reading of what an address names: a JSON list or one image
const { isZarrURL, isCziURL, parseDataset } = require('../public/js/page-helpers');

/**
 * Whether a source is a path of this server ("/test_data/cat.json"), not an
 * address elsewhere ("//host/x" included)
 * @param {string} source The source asked for
 * @returns {boolean} True for a path
 */
const isOwnPath = (source) => new URL(source, 'http://own.invalid').host === 'own.invalid';

module.exports = (app) => {
  app.get('/getTile', function (req, res) {
    const { source } = req.query;
    res.set(inertHeaders());

    if( !source ) {
      return res.status(404).send('source must be defined');
    }

    fetchPublic(source)
      .then(({ statusCode, headers, body }) => {
        res.status(statusCode);
        // setHeader: res.set would add a charset to the other server's type
        res.setHeader('content-type', relayedType(headers['content-type']));
        res.end(body);
      })
      .catch((err) => {
        (req.log || log).warn({ err, source }, 'cannot fetch tile');
        sendFailure(res, err);
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
        throw Object.assign(new Error('only http and https addresses'), { status: 400 });
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

      // a path of this server is read through the port the request came in on
      const own = isOwnPath(source);
      const { statusCode, body } = await (own ? fetchOwn(req, sourcePath) : fetchPublic(sourceHostname + sourcePath));

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
        } else if(typeof result === 'string' && own) {
          // on this server: the browser loads it itself
          if((new RegExp('^http')).test(tileSource) === false && tileSource[0] !== '/') {
            tileSource = '/' + tileSource;
          }
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
        sendText(res, 404, e);
      } else if (e.status) {
        // refused, or over a limit: our message, never the other server's
        sendFailure(res, e);
      } else {
        res.status(404).send(e);
      }
    }
  });
};
