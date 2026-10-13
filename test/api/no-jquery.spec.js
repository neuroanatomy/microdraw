'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M4d: jQuery 1.11.0 and the files that loaded it are gone. The pages that no
// longer load it are checked in the browser by test/e2e/no-jquery.spec.js.
describe('No jQuery served (M4d)', function () {
  [
    '/lib/jquery-1.11.0.min.js',
    '/lib/muijs/mui.js',
    '/doc/code.html',
    '/doc/doc.js'
  ].forEach((path) => {
    it(`GET ${path} is 404`, async function () {
      const res = await chai.request(U.serverURL).get(path);
      assert.equal(res.status, 404);
    });
  });

  it('GET /js/mui.js serves the jQuery-free port of muijs', async function () {
    // a script is not buffered as text by default: read it as a string
    const res = await chai.request(U.serverURL).get('/js/mui.js')
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (chunk) => { text += chunk; });
        r.on('end', () => cb(null, text));
      });
    assert.equal(res.status, 200);
    assert.include(res.body, 'window.MUI');
    assert.notMatch(res.body, /\$\(|jQuery\(/);
  });

  it('GET / does not load jQuery', async function () {
    const res = await chai.request(U.serverURL).get('/');
    assert.equal(res.status, 200);
    assert.notMatch(res.text, /<script[^>]*jquery/i);
  });
});
