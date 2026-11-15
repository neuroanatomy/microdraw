/* eslint-disable global-require */
/* eslint-disable max-statements */

const mustacheExpress = require('mustache-express');
const path = require('path');
const nwl = require('neuroweblab');
const {authTokenMiddleware} = nwl;
const {getHttpImg} = require('../serveHttpImages/serveHttpImages');
const log = require('../log');
const {refuseEmbedWrites} = require('../controller/embed/embed-access');

module.exports = (app) => {
  log.debug('configuring routes');

  // view engine setup
  app.engine('mustache', mustacheExpress());
  app.set('views', path.join(__dirname, '../views'));
  app.set('view engine', 'mustache');

  // set pass app config to req
  const configSetup = (req, res, next) => {
    req.appConfig = {
      loginMethods : app.get('loginMethods') || [],
      db : app.db
    };
    next();
  };

  app.use(configSetup);

  // no write from the embeddable viewer (T002 3.7, embed-access.js)
  app.use(refuseEmbedWrites);

  app.get('/', function (req, res) { // /auth/github

    // store return path in case of login
    req.session.returnTo = req.originalUrl;
    res.render('index', {
      title: 'MicroDraw',
      loginMethods : app.get('loginMethods') || [],
      user: req.user ? req.user : null
    });
  });

  app.use('/data', require('../controller/data/'));

  app.use('/user', require('../controller/user/'));

  app.use('/project', require('../controller/project/'));

  app.use('/search', require('../controller/search/'));

  app.use('/admin', require('../controller/admin/'));

  app.get('/image', getHttpImg);

  // The example pages moved to /examples/ (M8b): keep their old URLs working.
  // 302, not 301 (N3): browsers cache a permanent redirect for good.
  app.get(['/composer.html', '/composer-0.html', '/overlays.html'], (req, res) => {
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(302, `/examples${req.path}${query}`);
  });

  // The 10 regions label set moved to /labels/ (T002 3.2): keep the old URL
  // working. 302, not 301 (N3), as above.
  app.get('/js/10regions.json', (req, res) => {
    res.redirect(302, '/labels/10regions.json');
  });

  app.get('/microdraw', (req, res /*, next*/) => {
    res.render('partials/microdraw');
  });

  app.use('/api', authTokenMiddleware, require('../controller/api/'));

  /* patches for bypassing CORS header restrictions */
  require('./routesExtensions')(app);
};
