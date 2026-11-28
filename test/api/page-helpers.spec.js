'use strict';

const { assert } = require('chai');
const { fetchJSON, loadScript, parseDataset, fetchDataset, prepareTileSources, isCziURL, cziAddress } = require('../../app/public/js/page-helpers');

// The pages' one loadScript and one fetchJSON (T002 C2, W10). No server, no
// browser: fetch and document are stand-ins.
// eslint-disable-next-line max-statements
describe('Page helpers (T002 C2)', function () {
  const saved = {};
  beforeEach(function () {
    saved.fetch = global.fetch;
    saved.document = global.document;
  });
  afterEach(function () {
    global.fetch = saved.fetch;
    if (typeof saved.document === 'undefined') {
      delete global.document;
    } else {
      global.document = saved.document;
    }
  });

  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

  it('fetchJSON: passes the options, answers the parsed JSON, whatever its success key', async function () {
    const calls = [];
    global.fetch = (url, init) => {
      calls.push([url, init]);

      return Promise.resolve(answer(200, { success: false, names: ['a'] }));
    };
    const init = { headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    assert.deepEqual(await fetchJSON('/x.json', init), { success: false, names: ['a'] });
    assert.deepEqual(calls, [['/x.json', init]]);
  });

  it('fetchJSON: an error status rejects, with the status', async function () {
    global.fetch = () => Promise.resolve(answer(404, { error: 'not found' }));
    const err = await fetchJSON('/missing.json').then(() => null, (e) => e);
    assert.instanceOf(err, Error);
    assert.equal(err.status, 404);
    assert.equal(err.message, '/missing.json answered 404');
  });

  const fakeDocument = () => {
    const added = [];
    global.document = {
      createElement: (tag) => ({ tag }),
      body: { appendChild: (el) => added.push(el) }
    };

    return added;
  };

  it('loadScript: adds one script and resolves once it has loaded', async function () {
    const added = fakeDocument();
    const loading = loadScript('/js/a.js');
    assert.lengthOf(added, 1);
    assert.include(added[0], { tag: 'script', src: '/js/a.js' });
    added[0].onload();
    assert.isUndefined(await loading);
  });

  it('loadScript: rejects when the script cannot be loaded', async function () {
    const added = fakeDocument();
    const loading = loadScript('/js/b.js');
    added[0].onerror();
    const err = await loading.then(() => null, (e) => e);
    assert.equal(err.message, 'cannot load /js/b.js');
  });

  const dzi = (attributes = '') => `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<!-- made by a converter -->
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpeg" Overlap="1" TileSize="256" ${attributes}>
  <Size Height="360" Width="480"/>
</Image>`;

  it('parseDataset: a DeepZoom description is a list of that one image', function () {
    assert.deepEqual(parseDataset(dzi(), '/a/slide.tiles'), { tileSources: ['/a/slide.tiles'] });
  });

  it('parseDataset: with the pixel size the description gives', function () {
    assert.deepEqual(parseDataset(dzi('PixelsPerMeter="4539793"'), 's'), { tileSources: ['s'], pixelsPerMeter: 4539793 });
    for (const value of ['0', '-1', 'abc', '']) {
      assert.notProperty(parseDataset(dzi(`PixelsPerMeter="${value}"`), 's'), 'pixelsPerMeter', value);
    }
  });

  it('parseDataset: a JSON list is returned as it is', function () {
    const json = { tileSources: ['a.dzi'], names: ['a'], success: false };
    assert.deepEqual(parseDataset(JSON.stringify(json), 's'), json);
    assert.deepEqual(parseDataset('{"tileCodeY":[]}', 's'), { tileCodeY: [] });
  });

  it('parseDataset: anything else throws', function () {
    for (const text of ['<!DOCTYPE html><html></html>', '<Image/>', '<error>no</error>', 'not json', '']) {
      assert.throws(() => parseDataset(text, 's'), Error);
    }
  });

  it('fetchDataset: an OME-Zarr store is not fetched', async function () {
    global.fetch = () => Promise.reject(new Error('fetched'));
    for (const url of ['/a.zarr', 'https://host/a.zarr/', 'https://host/a.ozx?v=1']) {
      // eslint-disable-next-line no-await-in-loop -- one at a time
      assert.deepEqual(await fetchDataset(url), { tileSources: [{ type: 'ome-zarr', url }] });
    }
  });

  it('fetchDataset: parses what is fetched; an error status rejects', async function () {
    global.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(dzi()) });
    assert.deepEqual(await fetchDataset('/a.dzi'), { tileSources: ['/a.dzi'] });
    global.fetch = () => Promise.resolve(answer(404, {}));
    const err = await fetchDataset('/a.dzi').then(() => null, (e) => e);
    assert.equal(err.status, 404);
  });

  it('prepareTileSources: OME-Zarr addresses become sources, their reader loaded once', async function () {
    const loaded = [];
    const load = (src) => {
      loaded.push(src);

      return Promise.resolve();
    };
    const sources = ['a.dzi', '/b.zarr', { type: 'ome-zarr', url: 'c', z: 1 }];
    assert.deepEqual(await prepareTileSources(sources, load, 'http://host/data?source=x'), ['a.dzi', { type: 'ome-zarr', url: 'http://host/b.zarr' }, { type: 'ome-zarr', url: 'http://host/c', z: 1 }]);
    assert.deepEqual(loaded, ['/lib/omezarr-tilesource/omezarr-tilesource.js']);
  });

  it('prepareTileSources: DeepZoom alone loads nothing', async function () {
    const sources = ['a.dzi', 'https://host/slide.tiles', { type: 'image', url: 'a.png' }];
    assert.deepEqual(await prepareTileSources(sources, () => Promise.reject(new Error('loaded')), 'http://host/'), sources);
  });

  // eslint-disable-next-line max-statements
  describe('CZI files', function () {
    const RAW = 'https://fold.hd.free.fr/s/Tök en/download/image.czi?x=1&y=/';
    const BASE = 'https://md.example.org/data?source=x';
    const id = (url) => Buffer.from(new URL(url).href).toString('base64url');
    afterEach(function () {
      delete global.MICRODRAW_CZI_SERVICE;
    });

    it('isCziURL', function () {
      for (const url of ['a.czi', 'https://h/A.CZI', 'https://h/a.czi?v=1', '/p/a.czi#x']) {
        assert.isTrue(isCziURL(url), url);
      }
      for (const url of ['a.dzi', 'https://h/a.czi_files/1/0_0.jpg', 'https://h/a.czi/x.json', 'https://h/?f=a.czi.json']) {
        assert.isFalse(isCziURL(url), url);
      }
    });

    it('cziAddress: a file is read through the service, which gets its whole address', function () {
      global.MICRODRAW_CZI_SERVICE = '/czi/';
      assert.equal(cziAddress(RAW, BASE), `/czi/remote/${id(RAW)}.dzi`);
      global.MICRODRAW_CZI_SERVICE = 'http://127.0.0.1:8799';
      assert.equal(cziAddress(RAW, BASE), `http://127.0.0.1:8799/remote/${id(RAW)}.dzi`);
      assert.equal(cziAddress('/files/a.czi', BASE), `http://127.0.0.1:8799/remote/${id('https://md.example.org/files/a.czi')}.dzi`);
    });

    it('cziAddress: an address on the service already answers a description', function () {
      global.MICRODRAW_CZI_SERVICE = '/czi';
      for (const url of ['/czi/local/a.czi', 'https://md.example.org/czi/local/a.czi']) {
        assert.equal(cziAddress(url, BASE), url);
      }
      assert.match(cziAddress('https://elsewhere.org/czi/local/a.czi', BASE), /^\/czi\/remote\//);
    });

    // a service at the root of its host resolves to an address ending in /
    it('cziAddress: also on a service without a path, however it is written', function () {
      for (const service of ['http://127.0.0.1:8799', 'http://127.0.0.1:8799/']) {
        global.MICRODRAW_CZI_SERVICE = service;
        const own = 'http://127.0.0.1:8799/local/a.czi';
        assert.equal(cziAddress(own, BASE), own, service);
      }
    });

    it('cziAddress: without a service, an error saying so', function () {
      assert.throws(() => cziAddress(RAW, BASE), /no CZI service/);
    });

    it('fetchDataset: asks the service, never the file; its error is passed on', async function () {
      global.MICRODRAW_CZI_SERVICE = 'http://svc';
      const asked = [];
      global.fetch = (url) => {
        asked.push(url);

        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('the host h is not allowed') });
      };
      const err = await fetchDataset('https://h/a.czi').then(() => null, (e) => e);
      assert.deepEqual(asked, [`http://svc/remote/${id('https://h/a.czi')}.dzi`]);
      assert.include(err.message, 'the host h is not allowed');
    });

    it('prepareTileSources: CZI entries become service addresses', async function () {
      global.MICRODRAW_CZI_SERVICE = '/czi';
      const sources = await prepareTileSources(['a.dzi', 'https://h/a.czi'], () => Promise.resolve(), BASE);
      assert.deepEqual(sources, ['a.dzi', `/czi/remote/${id('https://h/a.czi')}.dzi`]);
    });
  });
});

