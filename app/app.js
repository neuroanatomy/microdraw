'use strict';

const fs = require('fs');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
//const favicon = require('serve-favicon');
const https = require('https');
const http = require('http');
const nwl = require('neuroweblab');
const microdrawWebsocketServer = require('./controller/microdrawWebsocketServer/microdrawWebsocketServer.js');
const routes = require('./routes/routes');
const log = require('./log');
const { ensureIndexes } = require('./controller/indexes');
let port;
let server;

//========================================================================================
// Configure server and web socket
//========================================================================================

// Normalize a port into a number, string, or false.
const normalizePort = function (val) {
  const tmpPort = parseInt(val, 10);
  // named pipe
  if (isNaN(tmpPort)) { return val; }
  // port number
  if (tmpPort >= 0) { return tmpPort; }

  return false;
};

// Turn a listen error into an actionable message.
const listenError = function (error, which, wanted) {
  if (error.syscall !== 'listen') { return error; }
  const bind = typeof wanted === 'string' ? 'Pipe ' + wanted : 'Port ' + wanted;
  switch (error.code) {
  case 'EACCES':
    return new Error(`${which}: ${bind} requires elevated privileges`);
  case 'EADDRINUSE':
    return new Error(
      `${which}: ${bind} is already in use. ` +
      `Stop whatever is listening on it (e.g. a running \`npm start\`), ` +
      `or set ${which === 'websocket server' ? 'WS_PORT' : 'PORT'} to a free port.`
    );
  default:
    return error;
  }
};

// Bind a server, resolving with the port actually assigned.
// Passing port 0 lets the OS pick a free one, which is what the tests use.
const listen = (srv, wanted, which) => new Promise((resolve, reject) => {
  const onListenError = (error) => reject(listenError(error, which, wanted));
  srv.once('error', onListenError);
  srv.listen(wanted, () => {
    srv.removeListener('error', onListenError);
    resolve(srv.address().port);
  });
});

// Event listener for HTTP server "listening" event.
const onListening = function () {
  const addr = server.address();
  log.info({ address: typeof addr === 'string' ? addr : addr.port }, 'http server listening');
};

// eslint-disable-next-line max-statements
const start = async function () {
  const app = express();

  port = normalizePort(process.env.PORT || '3000');

  // Create HTTP server.
  server = http.createServer(app);

  // Listen on provided port, on all network interfaces. `port` may be 0,
  // in which case the OS assigns a free port and we record the real one.
  port = await listen(server, port, 'app server');
  app.set('port', port);
  onListening();

  // CFG_PATH lets the E2E suite pin a known configuration instead of inheriting
  // whichever cfg.json the developer happens to have locally (it is gitignored,
  // so an `ssl: true` dev config would otherwise change how the tests render).
  const Config = JSON.parse(await fs.promises.readFile(process.env.CFG_PATH || './cfg.json'));
  microdrawWebsocketServer.dataDirectory = path.join(__dirname, '/public');

  if (Config.secure) {
    const options = {
      key: await fs.promises.readFile(Config.ssl_key),
      cert: await fs.promises.readFile(Config.ssl_cert)
    };
    if (Config.ssl_chain) {
      options.ca = await fs.promises.readFile(Config.ssl_chain);
    }
    microdrawWebsocketServer.server = https.createServer(options, app);
  } else {
    microdrawWebsocketServer.server = http.createServer(app);
  }

  const wsServer = microdrawWebsocketServer.server;
  const wsPort = await listen(
    wsServer,
    normalizePort(process.env.WS_PORT || '8080'),
    'websocket server'
  );
  log.info({ port: wsPort, secure: Boolean(Config.secure) }, 'websocket server listening');
  microdrawWebsocketServer.initSocketConnection();

  // Templates need this so the browser connects to the right websocket port.
  app.set('wsPort', wsPort);


  // CORS
  app.use(function (req, res, next) {
    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*'); // 'http://localhost:8888');
    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);
    // Pass to next layer of middleware
    next();
  });

  // uncomment after placing your favicon in /public
  //app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
  app.use(bodyParser.json({ limit: '50mb', extended: true }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(log.requestLog);

  /* setup DB */
  // var checkAnyoneUser = function () {

  //   /* check that the 'anyone' user exists. Insert it if it doesn't */
  //   db.queryUser({username: 'anyone'})
  //     .then((res) => {
  //       console.log('"anyone" user correctly configured.', res);
  //     })
  //     .catch((err) => {
  //       console.log('"anyone" user absent: adding one.', err);
  //       const anyone = {
  //         username: 'anyone',
  //         // nickname: 'anyone',
  //         name: 'Any User',
  //         joined: (new Date()).toJSON()
  //       };
  //       db.addUser(anyone);
  //     });
  // };
  // const db = require('./db/db')(null, checkAnyoneUser);
  // app.db = db;


  /* setup authentication */
  await nwl.init({
    app,
    MONGO_DB: process.env.MONGODB_TEST || process.env.MONGODB || '127.0.0.1:27017/microdraw',
    dirname: path.join(__dirname, "/auth/"),
    usernameField: "username",
    usersCollection: "users",
    projectsCollection: "projects",
    annotationsCollection: "annotations"
  });

  // indexes the queries need (idempotent; an error is logged, never fatal)
  await ensureIndexes(app.db.mongoDB());

  /* setup GUI routes */
  routes(app);


  // // catch 404 and forward to error handler
  // app.use(function (req, res, next) {
  //   console.log('ERROR: File not found', req.url);
  //   // var err = new Error('Not Found'); //, req);
  //   // err.status = 404;
  //   // next(err);
  // });

  // error handler
  // eslint-disable-next-line no-unused-vars
  app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // logged with the request line (pino-http reads res.err)
    res.err = err;

    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });

  return { app, server, wsServer, port, wsPort };
};

module.exports = { start };
