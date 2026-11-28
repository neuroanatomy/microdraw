'use strict';

// GET /getJson, the viewer's way to a description it cannot read itself, when
// what is there is one image and not a JSON list.
const http = require('http');
const chai = require('chai');
const chaiHttp = require('chai-http');
const sinon = require('sinon');
// the upstream runs on this computer, where the proxies may not go: here it
// stands for a public server (the refusals are in public-addresses.spec.js)
const guard = require('../../app/routes/publicFetch');
const U = require('../mocha.test.util');

chai.use(chaiHttp);
const { assert } = chai;

const DESCRIPTION = '<?xml version="1.0"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" ' +
  'Format="jpg" Overlap="0" TileSize="512" PixelsPerMeter="20000"><Size Width="480" Height="360"/></Image>';

// eslint-disable-next-line max-statements
describe('GET /getJson of a single image', function () {
  let upstream;
  let upstreamURL;

  before(async function () {
    upstream = http.createServer((req, res) => {
      if (req.url === '/slide.tiles') {
        res.end(DESCRIPTION);
      } else if (req.url === '/list.json') {
        res.end(JSON.stringify({ tileSources: ['stores/a.zarr', 'a.dzi', 'slides/b.czi'] }));
      } else {
        res.end('<!DOCTYPE html><html></html>');
      }
    });
    await new Promise((resolve) => { upstream.listen(0, '127.0.0.1', resolve); });
    upstreamURL = `http://127.0.0.1:${upstream.address().port}`;
    sinon.stub(guard, 'isRefusedAddress').returns(false);
  });
  after(function () {
    guard.isRefusedAddress.restore();
    upstream.close();
  });

  const getJson = (source) => chai.request(U.serverURL).get('/getJson')
    .query({ source });
  const body = (res) => JSON.parse(res.text);

  it('a DeepZoom description elsewhere: a list of that address', async function () {
    const res = await getJson(`${upstreamURL}/slide.tiles`);
    assert.equal(res.status, 200);
    assert.deepEqual(body(res), { tileSources: [`${upstreamURL}/slide.tiles`], pixelsPerMeter: 20000 });
  });

  it('a .dzi path on this server stays a path', async function () {
    const res = await getJson('/test_data/cat.dzi');
    assert.deepEqual(body(res), { tileSources: ['/test_data/cat.dzi'] });
  });

  it('an OME-Zarr store is not fetched', async function () {
    const res = await getJson(`${upstreamURL}/a.zarr`);
    assert.deepEqual(body(res), { tileSources: [{ type: 'ome-zarr', url: `${upstreamURL}/a.zarr` }] });
  });

  it('in a list, a relative OME-Zarr address is on its server, not proxied', async function () {
    const { tileSources } = body(await getJson(`${upstreamURL}/list.json`));
    assert.equal(tileSources[0], `${upstreamURL}/stores/a.zarr`);
    assert.include(tileSources[1], `/getTile?source=${upstreamURL}/a.dzi`);
    assert.equal(tileSources[2], `${upstreamURL}/slides/b.czi`);
  });

  it('a CZI file is never fetched: the viewer asks the CZI service', async function () {
    const res = await getJson(`${upstreamURL}/page.czi`);
    assert.deepEqual(body(res), { tileSources: [`${upstreamURL}/page.czi`] });
  });

  it('a web page is neither: 404', async function () {
    assert.equal((await getJson(`${upstreamURL}/page`)).status, 404);
  });
});
