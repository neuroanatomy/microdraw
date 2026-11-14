'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// A URL no route answers gets 404 in the form the request expects: the error
// page for a page, {"error":"Not found"} for JSON, plain text for anything else
// (a missing script, image or font), never Express's bare "Cannot GET".
describe('Unknown URLs: 404', function () {
  const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  const get = (pathname, accept = HTML) => chai.request(U.serverURL).get(pathname)
    .set('Accept', accept)
    .redirects(0);

  it('an unknown page gets the error page, with the path and a link home', async function () {
    const res = await get('/no-such-page/here');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /^text\/html/u);
    assert.include(res.text, 'href="/lib/nwl-components/fonts.css"');
    assert.include(res.text, '<title>MicroDraw: Page not found</title>');
    assert.include(res.text, '<h1>Page not found</h1>');
    // Mustache escapes / too
    assert.include(res.text, '<code>&#x2F;no-such-page&#x2F;here</code>');
    assert.include(res.text, '<a href="/">Go to the home page</a>');
    assert.notInclude(res.text, 'Cannot GET');
  }).timeout(U.shortTimeout);

  it('escapes the path', async function () {
    const res = await get('/x/<script>alert(1)</script>');
    assert.equal(res.status, 404);
    assert.notInclude(res.text, '<script>alert(1)</script>');
    assert.include(res.text, '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
  }).timeout(U.shortTimeout);

  it('HEAD on an unknown page gets 404', async function () {
    const res = await chai.request(U.serverURL).head('/no-such-page')
      .set('Accept', HTML);
    assert.equal(res.status, 404);
  }).timeout(U.shortTimeout);

  ['/project/json/no/such/thing', '/api/no-such-route'].forEach((pathname) => {
    it(`${pathname} gets 404 JSON`, async function () {
      const res = await get(pathname);
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /^application\/json/u);
      assert.deepEqual(res.body, { error: 'Not found' });
    }).timeout(U.shortTimeout);
  });

  it('a request that accepts JSON first gets 404 JSON', async function () {
    const res = await get('/no-such-page', 'application/json');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  }).timeout(U.shortTimeout);

  // a <script> or <img> asks with */* or image/*: no page comes back
  [['/lib/no-such/x.js', '*/*'], ['/img/x.png', 'image/avif,image/webp,*/*'], ['/img/x.png', HTML]]
    .forEach(([pathname, accept]) => {
      it(`a missing asset (${pathname}, Accept ${accept}) gets a plain 404, not HTML`, async function () {
        const res = await get(pathname, accept);
        assert.equal(res.status, 404);
        assert.match(res.headers['content-type'], /^text\/plain/u);
        assert.notInclude(res.text, '<');
      }).timeout(U.shortTimeout);
    });

  it('an existing page and an existing static file still give 200', async function () {
    const page = await get('/');
    assert.equal(page.status, 200);
    const file = await get('/css/shared-style.css', 'text/css,*/*;q=0.1');
    assert.equal(file.status, 200);
  }).timeout(U.shortTimeout);
});
