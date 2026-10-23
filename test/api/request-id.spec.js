'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// The request log (pino-http, app/log.js) gives every request an id and sends
// it back, so a line in the server log can be matched to what a user saw.
describe('Request id', function () {
  it('is generated and sent in X-Request-Id', async function () {
    const res = await chai.request(U.serverURL).get('/project/json/doesnotexist');
    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  }).timeout(U.shortTimeout);

  it('is taken from the request when the client sends one', async function () {
    const res = await chai.request(U.serverURL).get('/project/json/doesnotexist')
      .set('X-Request-Id', 'abc-123');
    assert.equal(res.headers['x-request-id'], 'abc-123');
  }).timeout(U.shortTimeout);
});
