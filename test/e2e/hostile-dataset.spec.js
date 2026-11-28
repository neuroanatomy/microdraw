'use strict';

// A dataset from anywhere runs nothing on this site, in the viewer or the
// embed viewer. Each payload would only set window.__ran.
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const RUN = 'window.__ran = true';
const size = { width: 512, height: 512, tileSize: 256 };
const FILES = {
  '/test_data/hostile-eval.json': { tileSources: [{ ...size, getTileUrl: `(${RUN}, function(){return ''})` }] },
  '/test_data/hostile-names.json': {
    tileSources: ['/test_data/cat.dzi'],
    names: [`<img src="x:" onerror="${RUN}">`]
  },
  '/test_data/hostile.jsonp': `${RUN}; f({"tileSources":["/test_data/cat.dzi"]})`
};

const project = U.createProjectWithPermission('e2ehostile', { files: 'view', annotations: 'view' });
// public, as an attacker's own project would be
project.collaborators.list[0].access = { collaborators: 'none', annotations: 'view', files: 'view' };
project.files.list = [{ source: '/test_data/hostile-eval.json', name: 'hostile' }];

let context;

// the page asks for the hostile files, which exist only here
const open = async (pageUrl) => {
  const page = await context.newPage();
  await page.setViewport({ width: U.width, height: U.height });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    const file = FILES[pathname];
    if (typeof file === 'undefined') {
      request.continue();
    } else {
      request.respond({
        status: 200,
        contentType: pathname.endsWith('.json') ? 'application/json' : 'application/javascript',
        body: typeof file === 'string' ? file : JSON.stringify(file)
      });
    }
  });
  await page.goto(U.url(pageUrl), { waitUntil: 'load' });

  return page;
};

// a full address: the viewer reads it itself, not through /getJson
const viewer = (pathname) => open(`/data?source=${encodeURIComponent(U.url(pathname))}&slice=0`);
const ran = (page) => page.evaluate(() => Boolean(window.__ran));

describe('a hostile dataset runs nothing', function () {
  before(async function () {
    await U.insertProject(project);
    context = await H.newContext();
  });

  after(async function () {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  const sourceError = (page) => page.waitForFunction(() => {
    const dom = window.Microdraw && window.Microdraw.dom;
    const box = dom && dom.querySelector('#sourceError');

    return window.__ran ? 'ran' : box && box.textContent;
  }, { timeout: U.mediumTimeout }).then((handle) => handle.jsonValue());

  it('a getTileUrl with code: the viewer says why it shows nothing', async function () {
    const page = await viewer('/test_data/hostile-eval.json');
    assert.include(await sourceError(page), 'getTileUrl');
    assert.isFalse(await ran(page));
  }).timeout(U.longTimeout);

  it('a getTileUrl with code: the embed viewer shows an error', async function () {
    const page = await open(`/data/embed?source=${encodeURIComponent('/test_data/hostile-eval.json')}`);
    await page.waitForFunction(() => window.__ran || document.body.textContent.includes('could not be loaded'), { timeout: U.mediumTimeout });
    assert.isFalse(await ran(page));
  }).timeout(U.longTimeout);

  it('a .jsonp with code besides its data is refused', async function () {
    const page = await viewer('/test_data/hostile.jsonp');
    const said = await sourceError(page);
    assert.notEqual(said, 'ran', 'the file was run as a script');
    assert.isFalse(await ran(page));
  }).timeout(U.longTimeout);

  it('a slice name with HTML is shown as text', async function () {
    const page = await viewer('/test_data/hostile-names.json');
    // the slice shown with its image, or the payload run
    await page.waitForFunction(() => {
      const M = window.Microdraw;

      return window.__ran || Boolean(M && M.viewer && M.viewer.world.getItemAt(0) && M.viewer.world.getItemAt(0).getFullyLoaded());
    }, { timeout: U.mediumTimeout });
    assert.isFalse(await ran(page), 'the name was read as HTML');
    const shown = await page.evaluate(() => {
      const el = window.Microdraw.dom.querySelector('#slice-number');

      return { text: el.textContent, elements: el.children.length };
    });
    assert.include(shown.text, '<img src="x:"');
    assert.equal(shown.elements, 0);
    assert.isFalse(await ran(page));
  }).timeout(U.longTimeout);
});
