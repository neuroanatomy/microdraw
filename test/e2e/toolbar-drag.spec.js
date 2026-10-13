'use strict';

/*
  M4e: dragging the viewer's toolbar (#menuBar) by its header (#toolsDragHandle,
  the cell with the slice number), in full screen only, with the mouse or a
  finger; and resizing the chat/script area by its bottom strip
  (#textInputResize). Modelled on BrainBox's
  test/integration/atlasmaker-tools-drag.test.js.

  Differences with BrainBox: microdraw's header is always shown (it holds the
  slice number and the dock buttons), so outside full screen the handle is
  there but does not drag; the toolbar is docked left by default, and leaving
  full screen docks a dragged toolbar back on the side it was docked on.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';
const DELTA = { x: 300, y: 120 };

const VIEWPORTS = {
  desktop: { width: 1200, height: 900 },
  tablet: { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
};

const inShadow = (page, sel) => page.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);

// Open the viewer and enter full screen with the toolbar's button, clicked
// (or tapped, on a touch screen) as the user would
const openViewerFullscreen = async (context, viewport) => {
  const page = await context.newPage();
  await page.setViewport(viewport);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await H.openData(page, U.url(DATA_URL));
  const button = await inShadow(page, '#fullscreen');
  await (viewport.hasTouch ? button.tap() : button.click());
  await page.waitForFunction(() => window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
  await H.waitForTools(page);

  return { page, pageErrors };
};

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = window.Microdraw.dom.querySelector(s).getBoundingClientRect();

  return { left: r.left, top: r.top, right: r.right, width: r.width, height: r.height };
}, sel);
const panelRect = (page) => rectOf(page, '#menuBar');
const toolbarDisplay = (page) => page.evaluate(() => window.Microdraw.dom.querySelector('body').getAttribute('data-toolbarDisplay'));

// The middle of the element, checking that it is what the user would touch there
const centreOf = async (page, sel) => {
  const c = await page.evaluate((s) => {
    const el = window.Microdraw.dom.querySelector(s);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = window.Microdraw.dom.elementFromPoint(x, y);

    return { x, y, width: r.width, height: r.height, onTop: Boolean(hit) && el.contains(hit) };
  }, sel);
  assert.isAbove(c.width, 0, `${sel} has a width`);
  assert.isAbove(c.height, 0, `${sel} has a height`);
  assert.isTrue(c.onTop, `nothing covers ${sel}`);

  return c;
};
const handleCentre = (page) => centreOf(page, '#toolsDragHandle');

const mouseDrag = async (page, from, delta = DELTA) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 });
  await page.mouse.up();
};

const touchDrag = async (page, from, delta = DELTA) => {
  await page.touchscreen.touchStart(from.x, from.y);
  for (let i = 1; i <= 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.touchscreen.touchMove(from.x + delta.x * i / 8, from.y + delta.y * i / 8);
  }
  await page.touchscreen.touchEnd();
};

const assertMovedByDelta = (before, after) => {
  assert.closeTo(after.left - before.left, DELTA.x, 1, 'moved horizontally by the drag');
  assert.closeTo(after.top - before.top, DELTA.y, 1, 'moved vertically by the drag');
};

// eslint-disable-next-line max-statements
describe('Dragging the viewer\'s toolbar (M4e)', () => {
  let context;
  let viewer;

  before(async () => {
    context = await H.newContext();
  });

  afterEach(async () => {
    if (viewer && viewer.page) { await viewer.page.close(); }
    viewer = null;
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('does not drag the toolbar outside full screen', async () => {
    const page = await context.newPage();
    viewer = { page };
    await page.setViewport(VIEWPORTS.desktop);
    await H.openData(page, U.url(DATA_URL));
    const before = await panelRect(page);
    await mouseDrag(page, await handleCentre(page));
    assert.deepEqual(await panelRect(page), before);
    assert.equal(await toolbarDisplay(page), 'left');
    assert.equal(await page.evaluate(() => getComputedStyle(window.Microdraw.dom.querySelector('#toolsDragHandle')).cursor), 'auto');
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('moves the toolbar by the mouse drag, docked left, and again once free', async () => {
    viewer = await openViewerFullscreen(context, VIEWPORTS.desktop);
    const { page } = viewer;
    assert.equal(await page.evaluate(() => getComputedStyle(window.Microdraw.dom.querySelector('#toolsDragHandle')).cursor), 'grab');

    let before = await panelRect(page);
    assert.equal(before.left, 5);
    await mouseDrag(page, await handleCentre(page));
    let after = await panelRect(page);
    assertMovedByDelta(before, after);
    assert.equal(await toolbarDisplay(page), 'free');

    // a second drag, from where the toolbar now is
    before = after;
    await mouseDrag(page, await handleCentre(page));
    after = await panelRect(page);
    assertMovedByDelta(before, after);
    assert.deepEqual(viewer.pageErrors, []);
  }).timeout(U.longTimeout);

  it('moves the toolbar by the mouse drag, docked right', async () => {
    viewer = await openViewerFullscreen(context, VIEWPORTS.desktop);
    const { page } = viewer;
    await (await inShadow(page, '#display-right')).click();
    const before = await panelRect(page);
    assert.equal(before.right, VIEWPORTS.desktop.width);
    await mouseDrag(page, await handleCentre(page), { x: -DELTA.x, y: DELTA.y });
    const after = await panelRect(page);
    assert.closeTo(after.left - before.left, -DELTA.x, 1);
    assert.closeTo(after.top - before.top, DELTA.y, 1);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('docks a dragged toolbar with the dock buttons, and when leaving full screen', async () => {
    viewer = await openViewerFullscreen(context, VIEWPORTS.desktop);
    const { page } = viewer;
    const docked = await panelRect(page);
    await mouseDrag(page, await handleCentre(page));
    assert.equal(await toolbarDisplay(page), 'free');

    await (await inShadow(page, '#display-right')).click();
    let r = await panelRect(page);
    assert.equal(await toolbarDisplay(page), 'right');
    assert.equal(r.right, VIEWPORTS.desktop.width);
    assert.equal(r.top, docked.top);

    await (await inShadow(page, '#display-left')).click();
    r = await panelRect(page);
    assert.equal(await toolbarDisplay(page), 'left');
    assert.deepEqual(r, docked);

    // dragged, then out of full screen: back on the left, where it was docked
    await mouseDrag(page, await handleCentre(page));
    assert.equal(await toolbarDisplay(page), 'free');
    await (await inShadow(page, '#fullscreen')).click();
    await page.waitForFunction(() => !window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
    await H.waitForTools(page);
    assert.equal(await toolbarDisplay(page), 'left');
    assert.deepEqual(await page.evaluate(() => window.Microdraw.dom.querySelector('#menuBar').style.position), '');
    assert.deepEqual(viewer.pageErrors, []);
  }).timeout(U.longTimeout);

  it('moves the toolbar by a touch drag on a tablet', async () => {
    viewer = await openViewerFullscreen(context, VIEWPORTS.tablet);
    const { page } = viewer;
    const before = await panelRect(page);
    await touchDrag(page, await handleCentre(page));
    const after = await panelRect(page);
    assertMovedByDelta(before, after);
    assert.equal(await toolbarDisplay(page), 'free');
    // no page scroll
    assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), [0, 0]);
    assert.deepEqual(viewer.pageErrors, []);
  }).timeout(U.longTimeout);

  describe('chat/script area height', () => {
    const blockHeight = (page) => page.evaluate(() => window.Microdraw.dom.querySelector('#textInputBlock').getBoundingClientRect().height);

    // eslint-disable-next-line max-statements
    it('follows a mouse drag of the strip at its bottom, down to 100 px', async () => {
      const page = await context.newPage();
      viewer = { page };
      await page.setViewport(VIEWPORTS.desktop);
      await H.openData(page, U.url(DATA_URL));
      const before = await blockHeight(page);
      await mouseDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: 80 });
      assert.closeTo(await blockHeight(page), before + 80, 1);
      await mouseDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: -1000 });
      assert.equal(await blockHeight(page), 100);
      // the message field is still there
      const msg = await rectOf(page, '#msg');
      const block = await rectOf(page, '#textInputBlock');
      assert.isAbove(msg.height, 0);
      assert.isAtMost(msg.top + msg.height, block.top + block.height);
    }).timeout(U.longTimeout);

    it('follows a touch drag on a tablet', async () => {
      viewer = await openViewerFullscreen(context, VIEWPORTS.tablet);
      const { page } = viewer;
      const before = await blockHeight(page);
      await touchDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: -80 });
      assert.closeTo(await blockHeight(page), before - 80, 1);
      assert.deepEqual(viewer.pageErrors, []);
    }).timeout(U.longTimeout);
  });
});
