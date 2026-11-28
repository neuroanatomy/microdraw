'use strict';

// /getTile, /image and /getJson relay what another server answers. Opened as a
// page, such an answer must not run scripts on MicroDraw's origin.
const http = require('http');
const chai = require('chai');
const chaiHttp = require('chai-http');
const U = require('../mocha.test.util');

chai.use(chaiHttp);
const { assert } = chai;

const PAGE = '<!DOCTYPE html><script>alert(1)</script>';
const DZI = '<?xml version="1.0"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" ' +
  'Format="jpg" Overlap="0" TileSize="512"><Size Width="480" Height="360"/></Image>';
const LIST = JSON.stringify({ tileSources: ['<script>alert(1)</script>'] });

// path: [status, content type or none, body]
const ANSWERS = {
  '/page': [200, 'text/html; charset=utf-8', PAGE],
  '/xhtml': [200, 'application/xhtml+xml', PAGE],
  '/script': [200, 'application/javascript', 'alert(1)'],
  '/untyped': [200, null, PAGE],
  '/tile.jpg': [200, 'image/jpeg', 'jpeg bytes'],
  '/drawing.svg': [200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  '/a.dzi': [200, 'application/xml', DZI],
  '/list.json': [200, 'application/json', LIST],
  '/gone': [404, 'text/html', PAGE]
};

// eslint-disable-next-line max-statements
describe('answers relayed from other servers', function () {
  let upstream;
  let upstreamURL;

  before(async function () {
    upstream = http.createServer((req, res) => {
      const [status, type, body] = ANSWERS[req.url] || [404, 'text/plain', 'no'];
      res.writeHead(status, type ? { 'Content-Type': type } : {});
      res.end(body);
    });
    await new Promise((resolve) => { upstream.listen(0, '127.0.0.1', resolve); });
    upstreamURL = `http://127.0.0.1:${upstream.address().port}`;
  });
  after(function () {
    upstream.close();
  });

  const get = (route, parameter, path) => chai.request(U.serverURL).get(route)
    .query({ [parameter]: `${upstreamURL}${path}` })
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => done(null, text));
    });

  const assertInert = (res) => {
    assert.equal(res.headers['content-security-policy'], 'sandbox; default-src \'none\'');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.notMatch(res.headers['content-type'] || '', /html|javascript|ecmascript/);
  };

  for (const [route, parameter] of [['/getTile', 'source'], ['/image', 'url']]) {
    describe(route, function () {
      for (const path of ['/page', '/xhtml', '/script', '/untyped']) {
        it(`serves ${path} as plain bytes`, async function () {
          const res = await get(route, parameter, path);
          assertInert(res);
          assert.equal(res.headers['content-type'], path === '/untyped' && route === '/image'
            ? 'image/jpeg'
            : 'application/octet-stream');
          assert.equal(res.body, ANSWERS[path][2]);
        });
      }

      for (const path of ['/tile.jpg', '/drawing.svg', '/a.dzi', '/list.json']) {
        it(`keeps the type of ${path}`, async function () {
          const res = await get(route, parameter, path);
          assertInert(res);
          assert.equal(res.headers['content-type'], ANSWERS[path][1]);
          assert.equal(res.body, ANSWERS[path][2]);
        });
      }
    });
  }

  it('/getTile keeps the status of an error, with an inert body', async function () {
    const res = await get('/getTile', 'source', '/gone');
    assert.equal(res.status, 404);
    assertInert(res);
  });

  it('/getTile says why it failed in plain text', async function () {
    const res = await chai.request(U.serverURL).get('/getTile')
      .query({ source: 'http://<script>.invalid/' });
    assert.equal(res.status, 500);
    assertInert(res);
  });

  it('/getJson answers a list as JSON', async function () {
    const res = await get('/getJson', 'source', '/list.json');
    assert.equal(res.status, 200);
    assertInert(res);
    assert.match(res.headers['content-type'], /^application\/json/);
    assert.property(JSON.parse(res.body), 'tileSources');
  });

  it('/getJson answers a single image as JSON', async function () {
    const res = await get('/getJson', 'source', '/a.dzi');
    assertInert(res);
    assert.match(res.headers['content-type'], /^application\/json/);
  });

  it('/getJson answers a remote error as plain text', async function () {
    const res = await get('/getJson', 'source', '/gone');
    assert.equal(res.status, 404);
    assertInert(res);
    assert.match(res.headers['content-type'], /^text\/plain/);
  });
});
