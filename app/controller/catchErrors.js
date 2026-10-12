// Wraps an async Express handler so that an error it throws answers 500
// instead of becoming an unhandled rejection: Express 4 does not catch those,
// and on Node >= 15 an unhandled rejection ends the process.
// `respond` sends the error answer; the default is JSON {error: 'Server error'}.
const jsonServerError = (res) => res.status(500).json({error: 'Server error'});

const catchErrors = (handler, respond = jsonServerError) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    console.log('ERROR:', err);
    if (!res.headersSent) {
      respond(res);
    }
  }
};

module.exports = { catchErrors };
