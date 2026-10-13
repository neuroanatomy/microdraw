/* global Microdraw */
'use strict';

/*
  The viewer embedded in the project page (M8a). Until M8 the page needed Vue 2
  from a CDN, which the offline e2e browser cannot reach, so the viewer was only
  tested on /data. Here, on /project/:name: opening an image from the project's
  file list, dragging the toolbar (M4f/M4g, D36/D37), including after the
  project page's resize handle narrows the viewer, and the offer to import
  unsaved annotations into the project (H3a, D25).

  The viewer lives in the shadow root of #microdraw (on /data: of #content).
*/
const chai = require('chai');
const { assert } = chai;
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');

const CAT = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const project = U.createPublicAnnotationProject('e2eprojectpageviewer');
project.name = 'Project page viewer';
// with a slice: without one the viewer opens the middle slice and adds it to the URL
const projectURL = (source) => U.url(`/project/${project.shortname}?source=${source}&project=${project.shortname}&slice=0`);

const shadowclick = async (page, host, sel) => {
  const handle = await page.evaluateHandle((h, s) => document.querySelector(h).shadowRoot.querySelector(s), host, sel);
  await handle.click();
};

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = window.Microdraw.dom.querySelector(s).getBoundingClientRect();

  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const panelRect = (page) => rectOf(page, '#menuBar');
const viewRect = (page) => rectOf(page, '#microdrawView');

// The middle of the drag handle, checking that nothing covers it
const handleCentre = async (page) => {
  const c = await page.evaluate(() => {
    const el = window.Microdraw.dom.querySelector('#toolsDragHandle');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = window.Microdraw.dom.elementFromPoint(x, y);

    return { x, y, onTop: Boolean(hit) && el.contains(hit) };
  });
  assert.isTrue(c.onTop, 'nothing covers the drag handle');

  return c;
};

const mouseDrag = async (page, from, delta) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 });
  await page.mouse.up();
};

const assertInside = async (page) => {
  const p = await panelRect(page);
  const v = await viewRect(page);
  assert.isAtLeast(p.left, v.left - 0.5, 'not past the left edge');
  assert.isAtLeast(p.top, v.top - 0.5, 'not past the top edge');
  assert.isAtMost(p.right, v.right + 0.5, 'not past the right edge');
  assert.isAtMost(p.bottom, v.bottom + 0.5, 'not past the bottom edge');

  return { p, v };
};

describe('The viewer in the project page (M8a)', () => {
  let context, page;
  const pageErrors = [];

  before(async () => {
    await U.removeAnnotations(CAT);
    await U.insertProject({ ...project });
  });

  beforeEach(async () => {
    pageErrors.length = 0;
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  afterEach(async () => {
    const ctx = context;
    context = null;
    await H.closeContext(ctx).catch(() => null);
  });

  after(async () => {
    await U.removeAnnotations(CAT);
    await U.removeProject(project.shortname);
  });

  // eslint-disable-next-line max-statements
  it('opens the project\'s files in the embedded viewer, from the file list', async () => {
    await H.openData(page, projectURL(CAT));
    let state = await page.evaluate(() => ({
      inShadow: Microdraw.dom === document.querySelector('#microdraw').shadowRoot,
      source: Microdraw.source,
      project: Microdraw.project,
      images: Microdraw.viewer.world.getItemCount()
    }));
    assert.deepEqual(state, { inShadow: true, source: CAT, project: project.shortname, images: 1 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: U.mediumTimeout }),
      page.click('#projectFiles tbody tr:nth-child(2) td:nth-child(1)')
    ]);
    // the file list's links have no slice: the viewer adds the one it opens
    const slice = await page.waitForFunction(() => new URLSearchParams(location.search).get('slice'), { timeout: U.mediumTimeout });
    await H.waitForMicrodraw(page, Number(await slice.jsonValue()));
    state = await page.evaluate(() => ({
      source: Microdraw.source,
      project: Microdraw.project,
      selected: [...document.querySelectorAll('#projectFiles tbody tr')].findIndex((tr) => tr.classList.contains('selected'))
    }));
    assert.deepEqual(state, { source: ZARR, project: project.shortname, selected: 1 });
    assert.deepEqual(pageErrors, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('the toolbar starts at the viewer\'s top left, drags, and stays inside when the viewer narrows', async () => {
    await H.openData(page, projectURL(CAT));
    const start = await panelRect(page);
    const view = await viewRect(page);
    assert.deepEqual([start.left - view.left, start.top - view.top], [5, 5], 'docked left is the top left corner');

    await mouseDrag(page, await handleCentre(page), { x: 300, y: 120 });
    const moved = await panelRect(page);
    assert.closeTo(moved.left - start.left, 300, 1);
    assert.closeTo(moved.top - start.top, 120, 1);
    assert.equal(await page.evaluate(() => Microdraw.dom.querySelector('body').getAttribute('data-toolbarDisplay')), 'free');

    // to the right edge, then widen the tables by 300 px: the viewer narrows
    await mouseDrag(page, await handleCentre(page), { x: 5000, y: 0 });
    let { p, v } = await assertInside(page);
    assert.closeTo(p.right, v.right, 0.5);
    const handle = await page.$eval('#resizeButton', (el) => {
      const r = el.getBoundingClientRect();

      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await mouseDrag(page, handle, { x: 300, y: 0 });
    ({ p, v } = await assertInside(page));
    assert.isBelow(v.width, view.width - 200, 'the viewer did not narrow');
    assert.closeTo(p.right, v.right, 0.5, 'the toolbar was not kept at the right edge');
    await handleCentre(page);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('offers to import unsaved annotations into the project, and saves them there (H3a)', async () => {
    await H.logIn(page);
    // a triangle drawn on /data, outside a project: kept in the browser
    await H.openData(page, U.url(`/data?source=${CAT}&slice=0`));
    await shadowclick(page, '#content', UI.DRAWPOLYGON);
    for (const [x, y] of [[300, 150], [400, 150], [350, 250], [300, 150]]) {
      // eslint-disable-next-line no-await-in-loop -- clicks in order
      await page.mouse.click(x, y);
    }
    await shadowclick(page, '#content', UI.SAVE);
    await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('microdraw:unsaved:')), { timeout: U.shortTimeout });
    await H.waitForTools(page);

    await H.openData(page, projectURL(CAT));
    await page.waitForFunction(() => {
      const el = Microdraw.dom.querySelector('#importDialog');

      return getComputedStyle(el).display !== 'none' && (/Import them into this project\?/).test(el.textContent);
    }, { polling: 50, timeout: U.shortTimeout });
    await page.evaluate(() => Microdraw.dom.querySelector('#importDialog button[data-action="import"]').click());
    assert.equal(await page.evaluate(() => Microdraw.ImageInfo[Microdraw.currentImage].Regions.length), 1);
    assert.isFalse(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('microdraw:unsaved:'))), 'the stash was kept');

    await H.waitForSave(page, () => shadowclick(page, '#microdraw', UI.SAVE));
    const saved = await U.findAnnotations({ fileID: new RegExp(`^${CAT.replace(/\./g, '\\.')}&slice=`), project: project.shortname });
    assert.lengthOf(saved, 1);
    assert.equal(saved[0].user, H.annotator.username);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.longTimeout);
});
