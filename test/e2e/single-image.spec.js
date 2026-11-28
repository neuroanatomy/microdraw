/* eslint-disable max-lines -- one stand-in service and the kinds of image it serves */
'use strict';

/*
  ?source= may be one image instead of a JSON list of images, and a list, a
  layer or the embed page may name any image by its address: DeepZoom (a .dzi,
  or a tile service answering with a DeepZoom description at any address),
  OME-Zarr stores, and CZI files, read through the CZI service (CZI_SERVICE_URL).
*/
const express = require('express');
const http = require('http');
const path = require('path');
const { assert } = require('chai');
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');

// Annotations are only saved inside a project: this spec opens its image in one.
const project = U.createPublicAnnotationProject('e2esingleimage');

const DZI = '/test_data/cat.dzi';
const ZARR = '/test_data/cat.zarr';
const TILES = path.join(__dirname, '../../app/public/test_data/cat_files');

// A stand-in for a tile service on another origin: slide.czi answers with a
// DeepZoom description (with the pixel size), its tiles, as OpenSeadragon names them, are under slide.tiles_files/.
const DESCRIPTION = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpeg" Overlap="1" TileSize="256" PixelsPerMeter="20000">
  <Size Width="480" Height="360"/>
</Image>`;
let service;
let serviceURL;
const serve = express();
serve.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});
const list = (res, tileSources) => res.json({ tileSources, pixelsPerMeter: 10000 });
serve.get('/slide.tiles', (req, res) => res.type('application/xml').send(DESCRIPTION));
serve.use('/slide.tiles_files', express.static(TILES));
// A stand-in for the CZI service, and a CZI file that must never be requested
const CZI = '/raw/slide.czi';
const asked = { files: [], ids: [] };
serve.get(CZI, (req, res) => {
  asked.files.push(req.originalUrl);
  res.send('ZISRAWFILE');
});
serve.get('/czi/remote/:id.dzi', (req, res) => {
  asked.ids.push(Buffer.from(req.params.id, 'base64url').toString());
  res.type('application/xml').send(DESCRIPTION);
});
serve.use((req, res, next) => {
  const tile = req.path.match(/^\/czi\/remote\/[\w-]+_files(\/.*)$/);
  if (!tile) { return next(); }

  return res.sendFile(path.join(TILES, tile[1]));
});
serve.get('/czi/local/slide.czi', (req, res) => res.type('application/xml').send(DESCRIPTION));
serve.use('/czi/local/slide.czi_files', express.static(TILES));
serve.get('/czi.json', (req, res) => list(res, [`${serviceURL}${CZI}`, `${serviceURL}/czi/local/slide.czi`]));
serve.get('/slides.json', (req, res) => list(res, [`${serviceURL}/slide.tiles`, `${serviceURL}/slide.tiles`]));
serve.get('/mixed.json', (req, res) => list(res, [U.url(ZARR), `${serviceURL}/slide.tiles`]));

let context;
let page;

const startService = async () => {
  service = http.createServer(serve);
  await new Promise((resolve) => { service.listen(0, '127.0.0.1', resolve); });
  serviceURL = `http://127.0.0.1:${service.address().port}`;
};

// OpenSeadragon may count an image as loaded when its tiles failed, so the
// tile responses are counted: DeepZoom tiles and OME-Zarr chunks
const TILE = /_files\/\d+\/|\.zarr\/\d+\/c\//;
const countTiles = (target) => {
  const tiles = { urls: [], failed: [] };
  target.on('response', (res) => {
    if (!TILE.test(res.url())) { return; }
    (res.ok() || res.status() === 304 ? tiles.urls : tiles.failed).push(res.url());
  });

  return tiles;
};

const assertTiles = (tiles, ...from) => {
  assert.deepEqual(tiles.failed, []);
  for (const prefix of from) {
    assert.isTrue(tiles.urls.some((u) => u.startsWith(prefix)), `a tile from ${prefix}, among ${tiles.urls}`);
  }
};

const embedOpens = async (address) => {
  const embed = await context.newPage();
  const tiles = countTiles(embed);
  try {
    await embed.goto(U.url(`/data/embed?source=${encodeURIComponent(address)}&project=${project.shortname}`));
    await embed.waitForFunction(() => {
      const item = window.MicrodrawEmbed.viewer && window.MicrodrawEmbed.viewer.world.getItemAt(0);

      return Boolean(item) && item.getFullyLoaded();
    }, { timeout: U.shortTimeout });

    const width = await embed.evaluate(() => window.MicrodrawEmbed.viewer.world.getItemAt(0).getContentSize().x);

    return { width, tiles };
  } finally {
    await embed.close();
  }
};

const dataPage = (source) => U.url(`/data?source=${encodeURIComponent(source)}&project=${project.shortname}&slice=0`);

const imageState = () => page.evaluate(() => ({
  width: window.Microdraw.viewer.source.width,
  height: window.Microdraw.viewer.source.height,
  images: window.Microdraw.imageOrder.length
}));

const scale = () => page.evaluate(() => {
  const bar = window.Microdraw.viewer.scalebarInstance;

  return { pixelsPerMeter: bar.pixelsPerMeter, shown: getComputedStyle(bar.divElt).display !== 'none' };
});

const clickTool = async (selector) => {
  const handle = await page.evaluateHandle(
    (s) => document.querySelector('#content').shadowRoot.querySelector(s),
    selector
  );
  await handle.click();
};

// eslint-disable-next-line max-statements
describe('A single image as the source', () => {
  before(async () => {
    await startService();
    process.env.CZI_SERVICE_URL = `${serviceURL}/czi`;
    // the embed page only shows datasets of the project
    project.files.list = [DZI, ZARR, `${serviceURL}/slide.tiles`, `${serviceURL}${CZI}`].map((source, i) => ({ source, name: `image${i}` }));
    await U.insertProject(project);
    context = await H.newContext();
    page = await context.newPage();
    // no browser cache: every test requests its tiles
    await page.setCacheEnabled(false);
    await page.setViewport({ width: U.width, height: U.height });
    await H.logIn(page);
  });

  it('opens a .dzi given as an absolute address', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(U.url(DZI)));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assertTiles(tiles, U.url('/test_data/cat_files/'));
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('opens a .dzi given as a path on this server', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(DZI));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assertTiles(tiles, U.url('/test_data/cat_files/'));
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('saves a region on a .dzi, which is there after a reload', async () => {
    await H.openData(page, dataPage(DZI));
    await clickTool(UI.DRAWPOLYGON);
    for (const [x, y] of [[400, 100], [500, 100], [500, 200], [400, 200], [400, 100]]) {
      // eslint-disable-next-line no-await-in-loop -- clicks in order
      await page.mouse.click(x, y);
    }
    await H.waitForSave(page, () => clickTool(UI.SAVE));

    await H.openData(page, dataPage(DZI));
    const regions = await H.regionState(page);
    assert.deepEqual(regions.map((r) => r.segments), [4]);
  }).timeout(U.longTimeout);

  it('shows no scale bar for a .dzi, which gives no pixel size', async () => {
    await H.openData(page, dataPage(DZI));
    assert.isFalse((await scale()).shown);
  }).timeout(U.mediumTimeout);

  it('opens a tile service address, with its pixel size', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(`${serviceURL}/slide.tiles`));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assert.deepEqual(await scale(), { pixelsPerMeter: 20000, shown: true });
    assertTiles(tiles, `${serviceURL}/slide.tiles_files/`);
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('opens a list naming tile service addresses', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(`${serviceURL}/slides.json`));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 2 });
    assert.equal((await scale()).pixelsPerMeter, 10000);
    assertTiles(tiles, `${serviceURL}/slide.tiles_files/`);
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('opens an OME-Zarr store given as a path on this server', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(ZARR));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assertTiles(tiles, U.url(`${ZARR}/`));
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('opens an OME-Zarr store given as an absolute address', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(U.url(ZARR)));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assertTiles(tiles, U.url(`${ZARR}/`));
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('opens a list naming an OME-Zarr store and a tile service address', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(`${serviceURL}/mixed.json`));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 2 });
    await H.openData(page, dataPage(`${serviceURL}/mixed.json`).replace('slice=0', 'slice=1'));
    assertTiles(tiles, U.url(`${ZARR}/`), `${serviceURL}/slide.tiles_files/`);
    page.removeAllListeners('response');
  }).timeout(U.longTimeout);

  it('adds single images as layers', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(DZI));
    const added = await page.evaluate((urls) => window.Microdraw.tools.layers.addLayers(
      urls.map((url, i) => ({ name: `layer${i}`, url, opacity: 50 }))
    ), [`${serviceURL}/slide.tiles`, U.url(ZARR)]);
    assert.equal(added, 2);
    await page.waitForFunction(() => {
      const { world } = window.Microdraw.viewer;

      return world.getItemCount() === 3 && [0, 1, 2].every((i) => world.getItemAt(i).getFullyLoaded());
    }, { timeout: U.shortTimeout });
    assertTiles(tiles, `${serviceURL}/slide.tiles_files/`, U.url(`${ZARR}/`));
    page.removeAllListeners('response');
  }).timeout(U.longTimeout);

  it('the embed page opens a single .dzi', async () => {
    const { width, tiles } = await embedOpens(DZI);
    assert.equal(width, 480);
    assertTiles(tiles, U.url('/test_data/cat_files/'));
  }).timeout(U.mediumTimeout);

  it('the embed page opens a single tile service address', async () => {
    const { width, tiles } = await embedOpens(`${serviceURL}/slide.tiles`);
    assert.equal(width, 480);
    assertTiles(tiles, `${serviceURL}/slide.tiles_files/`);
  }).timeout(U.mediumTimeout);

  it('the embed page opens a single OME-Zarr store', async () => {
    const { width, tiles } = await embedOpens(ZARR);
    assert.equal(width, 480);
    assertTiles(tiles, U.url(`${ZARR}/`));
  }).timeout(U.mediumTimeout);

  it('opens a CZI file by its own address, without requesting the file', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(`${serviceURL}${CZI}`));
    assert.deepEqual(await imageState(), { width: 480, height: 360, images: 1 });
    assert.deepEqual(await scale(), { pixelsPerMeter: 20000, shown: true });
    assertTiles(tiles, `${serviceURL}/czi/remote/`);
    assert.deepEqual(asked.files, []);
    assert.include(asked.ids, `${serviceURL}${CZI}`);
    page.removeAllListeners('response');
  }).timeout(U.mediumTimeout);

  it('keeps the annotations of a CZI file under its own address', async () => {
    const source = `${serviceURL}${CZI}`;
    await H.openData(page, dataPage(source));
    await clickTool(UI.DRAWPOLYGON);
    for (const [x, y] of [[400, 100], [500, 100], [500, 200], [400, 200], [400, 100]]) {
      // eslint-disable-next-line no-await-in-loop -- clicks in order
      await page.mouse.click(x, y);
    }
    await H.waitForSave(page, () => clickTool(UI.SAVE));
    const saved = await U.getDB().collection('annotations')
      .find({ project: project.shortname, fileID: `${source}&slice=0` })
      .toArray();
    assert.lengthOf(saved, 1);
  }).timeout(U.longTimeout);

  it('opens a list naming a CZI file and a file of the service itself', async () => {
    const tiles = countTiles(page);
    await H.openData(page, dataPage(`${serviceURL}/czi.json`));
    await H.openData(page, dataPage(`${serviceURL}/czi.json`).replace('slice=0', 'slice=1'));
    assertTiles(tiles, `${serviceURL}/czi/remote/`, `${serviceURL}/czi/local/slide.czi_files/`);
    assert.deepEqual(asked.files, []);
    page.removeAllListeners('response');
  }).timeout(U.longTimeout);

  it('the embed page opens a CZI file', async () => {
    const { width, tiles } = await embedOpens(`${serviceURL}${CZI}`);
    assert.equal(width, 480);
    assertTiles(tiles, `${serviceURL}/czi/remote/`);
    assert.deepEqual(asked.files, []);
  }).timeout(U.mediumTimeout);

  it('without a CZI service, says so and does not request the file', async () => {
    delete process.env.CZI_SERVICE_URL;
    try {
      await page.goto(dataPage(`${serviceURL}${CZI}`));
      const message = await page.waitForFunction(() => {
        const shadow = document.querySelector('#content').shadowRoot;
        const alert = shadow && shadow.querySelector('#sourceError');

        return alert && alert.textContent;
      }, { timeout: U.shortTimeout });
      assert.include(await message.jsonValue(), 'no CZI service');
      assert.deepEqual(asked.files, []);
    } finally {
      process.env.CZI_SERVICE_URL = `${serviceURL}/czi`;
    }
  }).timeout(U.mediumTimeout);

  after(async () => {
    delete process.env.CZI_SERVICE_URL;
    try {
      await H.closeContext(context);
    } finally {
      if (service) {
        service.closeAllConnections();
        service.close();
      }
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
    }
  });
});
