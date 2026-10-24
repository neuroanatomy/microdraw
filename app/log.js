// The server's logger. JSON lines in production, readable lines in development.
// LOG_LEVEL: fatal, error, warn, info (default), debug, trace or silent.
// Use `log.child({ module: 'x' })` for a component, and put data in the first
// argument: log.error({ err, project }, 'cannot save project').
const { randomUUID } = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const options = {
  level: process.env.LOG_LEVEL || 'info',
  base: null, // no pid and hostname: one process on one host
  serializers: { err: pino.stdSerializers.err }
};

// pino-pretty is a dev dependency: production falls back to plain JSON lines.
const prettyStream = () => {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    return require('pino-pretty')({ colorize: true, ignore: 'pid,hostname,req,res' });
  } catch (err) {
    return null;
  }
};

const stream = prettyStream();
const log = stream ? pino(options, stream) : pino(options);

// One line per finished request, with an id shared by every line logged through
// `req.log` while handling it (it is also sent back as the X-Request-Id header).
// Static files are served before this middleware, so they are not logged.
const requestLog = pinoHttp({
  logger: log,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', id);

    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) {
      return 'error';
    }

    // 404 is mostly crawlers probing for WordPress and the like: not a warning
    return res.statusCode >= 400 && res.statusCode !== 404 ? 'warn' : 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
  customProps: (req) => ({ user: (req.user && req.user.username) || req.tokenUsername }),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode })
  }
});

module.exports = log;
module.exports.requestLog = requestLog;
