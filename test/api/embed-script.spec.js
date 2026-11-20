'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// GET /embed.js, the loader third-party pages include (T002 N3): made by
// nwl-components' embedScript(), served with the headers the static file had.
describe('Embed loader GET /embed.js (T002 N3)', function () {
  it('answers with the static file\'s headers and microdraw\'s names', async function () {
    // read the body as text whatever the type (superagent buffers JavaScript as bytes)
    const res = await chai.request(U.serverURL).get('/embed.js')
      .buffer(true)
      .parse((response, done) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => done(null, text));
      });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/javascript; charset=UTF-8');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['cache-control'], 'public, max-age=0');
    assert.isString(res.headers.etag);
    assert.isNotEmpty(res.headers.etag);
    for (const name of ['microdraw:embed-resize', '/data/embed', '__microdrawEmbeds']) {
      assert.include(res.body, name);
    }
  }).timeout(U.shortTimeout);
});
