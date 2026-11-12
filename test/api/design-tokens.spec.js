'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// nwl-components' design tokens, served from node_modules (UI kit decision U9)
// and linked by every page through partials/header.mustache.
describe('Design tokens (UI kit step 5)', function () {
  it('/lib/nwl-components/tokens.css answers 200 with the tokens', async function () {
    const res = await chai.request(U.serverURL).get('/lib/nwl-components/tokens.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/css/u);
    assert.include(res.text, '--nwl-bg:');
  }).timeout(U.shortTimeout);

  it('the home page links them', async function () {
    const res = await chai.request(U.serverURL).get('/');
    assert.equal(res.status, 200);
    assert.include(res.text, 'href="/lib/nwl-components/tokens.css"');
  }).timeout(U.shortTimeout);
});
