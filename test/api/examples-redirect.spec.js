'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// The example pages moved to /examples/ (M8b). Their old URLs redirect there
// with 302, not 301 (N3): a permanent redirect is cached by browsers, so the
// old URLs could never be given back to something else.
describe('Old example URLs (M8b, N3)', function () {
  ['composer.html', 'composer-0.html', 'overlays.html'].forEach((page) => {
    it(`/${page} answers 302 to /examples/${page}, with the query string`, async function () {
      const res = await chai.request(U.serverURL).get(`/${page}?config=/a%20b.json&x=1`)
        .redirects(0);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, `/examples/${page}?config=/a%20b.json&x=1`);
    }).timeout(U.shortTimeout);
  });

  it('/examples/<page> itself is served', async function () {
    const res = await chai.request(U.serverURL).get('/examples/composer.html')
      .redirects(0);
    assert.equal(res.status, 200);
  }).timeout(U.shortTimeout);
});
