'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// NeuroWebLab's 404 catch-all and error handler (T002 M6b), with the rule
// BrainBox has: a …/json path is a JSON path, an error from a JSON request is
// answered as JSON, a 5xx message stays on the server outside development.
describe('Unknown URLs and errors: JSON or page', function () {
  const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

  ['/api/nothing/json', '/no-such-page/json'].forEach((pathname) => {
    it(`${pathname} (ends in /json) gets 404 JSON`, async function () {
      const res = await chai.request(U.serverURL).get(pathname)
        .set('Accept', HTML)
        .redirects(0);
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /^application\/json/u);
      assert.deepEqual(res.body, { error: 'Not found' });
    }).timeout(U.shortTimeout);
  });

  // body-parser fails before any route: its error (400) reaches the handler
  const postMalformed = (pathname, accept) => chai.request(U.serverURL).post(pathname)
    .set('Content-Type', 'application/json')
    .set('Accept', accept)
    .redirects(0)
    .send('{"not": json');

  ['/api/', '/project/json/no-such-project'].forEach((pathname) => {
    it(`malformed JSON to ${pathname} gets a 400 as JSON`, async function () {
      const res = await postMalformed(pathname, HTML);
      assert.equal(res.status, 400);
      assert.match(res.headers['content-type'], /^application\/json/u);
      assert.isString(res.body.error);
      assert.isNotEmpty(res.body.error);
    }).timeout(U.shortTimeout);
  });

  it('malformed JSON to a non-JSON path, asking for HTML, gets the error page with 400', async function () {
    const res = await postMalformed('/no-such-page', HTML);
    assert.equal(res.status, 400);
    assert.match(res.headers['content-type'], /^text\/html/u);
    assert.include(res.text, '<title>MicroDraw: ');
  }).timeout(U.shortTimeout);
});

// No request reaches a 5xx without test-only code: the handler microdraw
// passes to app.use is called with a fake request and response instead.
// eslint-disable-next-line max-statements
describe('The error handler microdraw uses', function () {
  // required here, so that each case fails on its own when it is missing
  // eslint-disable-next-line global-require
  const handler = () => require('../../app/errors').errorHandler;

  const fakeReq = ({ env, accept = 'html', path = '/a/page' }) => ({
    method: 'GET',
    originalUrl: path,
    path,
    app: { get: (key) => (key === 'env' ? env : null) },
    accepts: (types) => (types.includes(accept) ? accept : false)
  });

  const fakeRes = ({ headersSent = false } = {}) => {
    const res = {
      headersSent,
      statusCode: 200,
      status (code) { this.statusCode = code; },
      json (body) { this.sent = { json: body }; },
      render (view, locals) { this.sent = { view, locals }; }
    };

    return res;
  };

  const serverError = () => Object.assign(new Error('secret detail'), { status: 503 });

  it('outside development, a 5xx page says "Server error" and gets error: {status}', function () {
    const res = fakeRes();
    handler()(serverError(), fakeReq({ env: 'production' }), res, () => assert.fail('next called'));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.sent, { view: 'error', locals: { message: 'Server error', error: { status: 503 } } });
  });

  it('outside development, a 5xx from a JSON request is {error: "Server error"}', function () {
    const res = fakeRes();
    handler()(serverError(), fakeReq({ env: 'production', accept: 'json' }), res, () => assert.fail('next called'));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.sent, { json: { error: 'Server error' } });
  });

  it('outside development, a 4xx keeps its message', function () {
    const res = fakeRes();
    const err = Object.assign(new Error('Bad thing'), { status: 400 });
    handler()(err, fakeReq({ env: 'production' }), res, () => assert.fail('next called'));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.sent.locals, { message: 'Bad thing', error: { status: 400 } });
  });

  it('in development, the page shows the message and gets the error', function () {
    const res = fakeRes();
    const err = serverError();
    handler()(err, fakeReq({ env: 'development' }), res, () => assert.fail('next called'));
    assert.equal(res.statusCode, 503);
    assert.equal(res.sent.locals.message, 'secret detail');
    assert.strictEqual(res.sent.locals.error, err);
  });

  it('an error without a status is a 500', function () {
    const res = fakeRes();
    handler()(new Error('boom'), fakeReq({ env: 'production' }), res, () => assert.fail('next called'));
    assert.equal(res.statusCode, 500);
  });

  it('sets res.err, for the request log line (pino-http)', function () {
    const res = fakeRes();
    const err = Object.assign(new Error('Bad thing'), { status: 400 });
    handler()(err, fakeReq({ env: 'production' }), res, () => assert.fail('next called'));
    assert.strictEqual(res.err, err);
  });

  it('passes the error on when headers were already sent', function () {
    const res = fakeRes({ headersSent: true });
    const err = serverError();
    let passed;
    handler()(err, fakeReq({ env: 'production' }), res, (e) => { passed = e; });
    assert.strictEqual(passed, err);
    assert.isUndefined(res.sent);
  });
});
