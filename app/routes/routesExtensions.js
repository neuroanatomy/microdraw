// const url = require('url');

const request = require('request');

const Config = require('../../cfg.json');
// const { createRelativePositionFromTypeIndex } = require('yjs');

module.exports = (app) => {
  app.get('/getTile', function (req, res) {
    const { source } = req.query;

    if( !source ) {
      return res.status(404).send('source must be defined');
    }
    request(req.query.source, {})
      .on('error', function(err) {
        console.error('Error:', err.message);
        res.status(404).send(`Cannot fetch ${source}`);
      })
      .pipe(res);
  });

  // eslint-disable-next-line max-statements
  app.get('/getJson', function (req, res) {
    const { source } = req.query;

    if( !source ) {
      return res.status(404).send('source must be defined');
    }
    const thisHostname = Config.hostname;
    let sourceHostname, sourcePath;
    try {
      const url = new URL(source);
      sourceHostname = url.origin;
      sourcePath = url.pathname;
    } catch (err) {
      sourceHostname = thisHostname;
      sourcePath = source;
    }

    request(sourceHostname + sourcePath, (err, resp, body) => {
      try {
        if (err) {
          throw err;
        }

        if ((/(error)/).test(sourcePath)) {
          console.log({ body });
        }

        if(resp && resp.statusCode >= 400) {
          throw body;
        }

        const json = JSON.parse(body);
        json.tileSources = json.tileSources.map((result) => {
          let tileSource = result;
          if (typeof result === 'string' && !(/^http/).test(tileSource)) {
            if(tileSource[0] === '/') {
              tileSource = thisHostname + '/getTile?source=' + sourceHostname + tileSource;
            } else {
              tileSource = thisHostname + '/getTile?source=' + sourceHostname + '/' + tileSource;
            }
          }

          console.log(tileSource);

          return tileSource;
        });

        res.status(200).send(JSON.stringify(json));
      } catch (e) {
        console.log('Error at /getJson', e);
        res.status(404).send(e);
      }
    });
  });
};
