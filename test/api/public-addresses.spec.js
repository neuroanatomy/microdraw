'use strict';

// /getTile, /getJson and /image fetch only public addresses (S1a, F2 of the
// access audit of 2026-10-19): never this computer or the local network, also
// not through a name, a redirect or the IPv4-mapped form, and with size and
// time limits. A refusal is our plain text, never what the other server sent.
const http = require('http');
const chai = require('chai');
const chaiHttp = require('chai-http');
const sinon = require('sinon');
const U = require('../mocha.test.util');
const guard = require('../../app/routes/publicFetch');

chai.use(chaiHttp);
const { assert } = chai;

const SECRET = 'internal service: not for the proxies';
const DZI = '<?xml version="1.0"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" ' +
  'Format="jpg" Overlap="0" TileSize="512"><Size Width="480" Height="360"/></Image>';
const ROUTES = [['/getTile', 'source'], ['/getJson', 'source'], ['/image', 'url']];

const listen = (server, host) => new Promise((resolve) => { server.listen(0, host, resolve); });

// eslint-disable-next-line max-statements
describe('the proxies fetch only public addresses', function () {
  let inside;
  // the port of the server on this computer, and the paths asked of it
  const upstream = { port: 0 };
  const insideRequests = [];
  const realCheck = guard.isRefusedAddress;
  const realLimits = { MAX_BYTES: guard.MAX_BYTES, TIME_LIMIT_MS: guard.TIME_LIMIT_MS };

  // path: what a server on this computer would answer, if it were reached
  const ANSWERS = {
    '/redirect-inside': (res) => res.writeHead(302, { Location: `http://[::1]:${upstream.port}/secret` }).end(),
    '/redirect-out': (res) => res.writeHead(302, { Location: `http://tiles.example.org:${upstream.port}/a.dzi` }).end(),
    '/a.dzi': (res) => res.writeHead(200, { 'Content-Type': 'application/xml' }).end(DZI),
    '/list.json': (res) => res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ tileSources: ['a.dzi'] })),
    '/large': (res) => res.end('x'.repeat(2000)),
    '/large-chunked': (res) => {
      res.write('x'.repeat(600));
      res.end('x'.repeat(600));
    },
    '/slow': (res) => setTimeout(() => res.end('late'), 2000)
  };

  before(async function () {
    inside = http.createServer((req, res) => {
      insideRequests.push(req.url);
      (ANSWERS[req.url] || ((r) => r.end(SECRET)))(res);
    });
    // on both loopbacks, at the same port
    await listen(inside, '::');
    upstream.port = inside.address().port;
  });
  after(function () {
    inside.close();
  });
  beforeEach(function () {
    insideRequests.length = 0;
  });
  afterEach(function () {
    sinon.restore();
    Object.assign(guard, realLimits);
  });

  const get = (route, parameter, address) => chai.request(U.serverURL).get(route)
    .query({ [parameter]: address })
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => done(null, text));
    });

  const assertRefused = (res, status = 403) => {
    assert.equal(res.status, status);
    assert.match(res.headers['content-type'], /^text\/plain/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.notInclude(res.body, SECRET);
  };

  // a name with a public address that is, for the test, this computer
  const publicName = () => {
    sinon.stub(guard, 'lookup').resolves([{ address: '127.0.0.1', family: 4 }]);
    sinon.stub(guard, 'isRefusedAddress').callsFake((address) => address !== '127.0.0.1' && realCheck(address));
  };

  describe('internal addresses', function () {
    const hosts = ['127.0.0.1', '[::1]', '10.1.2.3', '169.254.169.254', '[::ffff:127.0.0.1]'];
    for (const [route, parameter] of ROUTES) {
      for (const host of hosts) {
        it(`${route} refuses ${host}`, async function () {
          assertRefused(await get(route, parameter, `http://${host}:${upstream.port}/secret.json`));
        });
      }
    }

    it('nothing reached the server on this computer', async function () {
      for (const [route, parameter] of ROUTES) {
        // eslint-disable-next-line no-await-in-loop -- one after the other
        await get(route, parameter, `http://127.0.0.1:${upstream.port}/secret.json`);
      }
      assert.deepEqual(insideRequests, []);
    });
  });

  describe('the address checked is the one connected to', function () {
    for (const [route, parameter] of ROUTES) {
      it(`${route} refuses a public-looking name with an internal address`, async function () {
        sinon.stub(guard, 'lookup').resolves([{ address: '127.0.0.1', family: 4 }]);
        assertRefused(await get(route, parameter, `http://tiles.example.org:${upstream.port}/secret.json`));
        assert.deepEqual(insideRequests, []);
      });
    }

    it('refuses a name with one internal address among public ones', async function () {
      sinon.stub(guard, 'lookup').resolves([{ address: '192.0.2.1', family: 4 }, { address: '10.0.0.1', family: 4 }]);
      assertRefused(await get('/getTile', 'source', `http://tiles.example.org:${upstream.port}/secret`));
    });
  });

  describe('scheme', function () {
    for (const [route, parameter] of ROUTES) {
      for (const address of ['file:///etc/passwd', 'ftp://example.org/x', 'gopher://127.0.0.1:6379/_x']) {
        it(`${route} refuses ${address.split(':')[0]}:`, async function () {
          assertRefused(await get(route, parameter, address), 400);
        });
      }
    }
  });

  describe('redirects', function () {
    it('/image refuses a redirect to an internal address, at that hop', async function () {
      publicName();
      assertRefused(await get('/image', 'url', `http://tiles.example.org:${upstream.port}/redirect-inside`));
      assert.deepEqual(insideRequests, ['/redirect-inside']);
    });

    it('/image follows a redirect to a public address', async function () {
      publicName();
      const res = await get('/image', 'url', `http://tiles.example.org:${upstream.port}/redirect-out`);
      assert.equal(res.status, 200);
      assert.equal(res.body, DZI);
    });

    it('/getTile follows no redirect', async function () {
      publicName();
      const res = await get('/getTile', 'source', `http://tiles.example.org:${upstream.port}/redirect-inside`).redirects(0);
      assert.equal(res.status, 302);
      assert.deepEqual(insideRequests, ['/redirect-inside']);
    });
  });

  describe('limits', function () {
    for (const [route, parameter] of ROUTES) {
      for (const path of ['/large', '/large-chunked']) {
        it(`${route} cuts an answer over the size limit (${path})`, async function () {
          publicName();
          guard.MAX_BYTES = 1000;
          const res = await get(route, parameter, `http://tiles.example.org:${upstream.port}${path}`);
          assertRefused(res, 413);
          assert.notInclude(res.body, 'xxx');
        });
      }
    }

    it('/getTile gives up on a slow server', async function () {
      publicName();
      guard.TIME_LIMIT_MS = 100;
      assertRefused(await get('/getTile', 'source', `http://tiles.example.org:${upstream.port}/slow`), 502);
    });
  });

  describe('a public DeepZoom image still works', function () {
    it('/getJson reads its description', async function () {
      publicName();
      const res = await get('/getJson', 'source', `http://tiles.example.org:${upstream.port}/a.dzi`);
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body).tileSources, [`http://tiles.example.org:${upstream.port}/a.dzi`]);
    });

    it('/getJson reads a list, and its tiles go through /getTile', async function () {
      publicName();
      const res = await get('/getJson', 'source', `http://tiles.example.org:${upstream.port}/list.json`);
      assert.equal(res.status, 200);
      const [tile] = JSON.parse(res.body).tileSources;
      assert.include(tile, `/getTile?source=http://tiles.example.org:${upstream.port}/a.dzi`);
    });

    it('/getTile relays it', async function () {
      publicName();
      const res = await get('/getTile', 'source', `http://tiles.example.org:${upstream.port}/a.dzi`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/xml');
      assert.equal(res.body, DZI);
    });
  });

  describe('a path of this server', function () {
    it('/getJson reads it through its own port, whatever the Host header says', async function () {
      const res = await chai.request(U.serverURL).get('/getJson')
        .set('Host', `127.0.0.1:${upstream.port}`)
        .query({ source: '/test_data/cat.json' });
      assert.equal(res.status, 200);
      assert.deepEqual(insideRequests, []);
      assert.property(JSON.parse(res.text), 'tileSources');
    });

    it('/getJson does not take //host for a path', async function () {
      const res = await get('/getJson', 'source', `//127.0.0.1:${upstream.port}/secret`);
      assertRefused(res);
    });
  });
});
