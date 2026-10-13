/* eslint max-lines: ["error", 400] -- one spec for the toolbar drag, normal view and full screen, mouse and touch (M4f, 2026-10-13) */
'use strict';

/*
  Dragging the viewer's toolbar (#menuBar) by its header's middle cell
  (#toolsDragHandle, around the slice number), with the mouse or a finger; and
  resizing the chat/script area by its bottom strip (#textInputResize).
  Modelled on BrainBox's test/integration/atlasmaker-tools-drag.test.js.

  M4e: in full screen only, like BrainBox. M4f (microdraw D36): microdraw's
  toolbar always floats over the image, so it is draggable all the time, kept
  inside the viewer area (#microdrawView) while dragging, on window resize and
  on entering or leaving full screen, and its position is remembered in
  localStorage (per browser) until a dock button docks it again.

  Each test has its own browser context (its own localStorage) and its page is
  the only one open: touch moves are sent with animation frames, which a page
  behind another may not get. Finger moves go in steps (Chrome may hold the
  last one until the next input event).
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';
const DELTA = { x: 300, y: 120 };
const FAR = 5000;
const STORAGE_KEY = 'microdraw.toolbarPosition';

const VIEWPORTS = {
  desktop: { width: 1200, height: 900 },
  tablet: { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
};

const inShadow = (page, sel) => page.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
const press = async (page, sel, touch = false) => {
  const el = await inShadow(page, sel);
  await (touch ? el.tap() : el.click());
};

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = window.Microdraw.dom.querySelector(s).getBoundingClientRect();

  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const panelRect = (page) => rectOf(page, '#menuBar');
const viewRect = (page) => rectOf(page, '#microdrawView');
const toolbarDisplay = (page) => page.evaluate(() => window.Microdraw.dom.querySelector('body').getAttribute('data-toolbarDisplay'));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);

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

const assertMovedByDelta = (before, after, delta = DELTA) => {
  assert.closeTo(after.left - before.left, delta.x, 1, 'moved horizontally by the drag');
  assert.closeTo(after.top - before.top, delta.y, 1, 'moved vertically by the drag');
};

// The toolbar is inside the viewer area (at its top when it is taller than it)
const assertInside = async (page) => {
  const p = await panelRect(page);
  const v = await viewRect(page);
  assert.isAtLeast(p.left, v.left - 0.5, 'not past the left edge');
  assert.isAtLeast(p.top, v.top - 0.5, 'not past the top edge');
  assert.isAtMost(p.right, v.right + 0.5, 'not past the right edge');
  if (p.height <= v.height) {
    assert.isAtMost(p.bottom, v.bottom + 0.5, 'not past the bottom edge');
  } else {
    assert.closeTo(p.top, v.top, 0.5, 'taller than the viewer: at its top');
  }

  return { p, v };
};

// eslint-disable-next-line max-statements
describe('Dragging the viewer\'s toolbar (M4e, M4f)', () => {
  let context;
  let page;
  let pageErrors;

  // A new context per test: its own localStorage, and its page alone in it
  const openViewer = async (viewport, { fullscreen = false } = {}) => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport(viewport);
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await H.openData(page, U.url(DATA_URL));
    if (fullscreen) {
      await press(page, '#fullscreen', viewport.hasTouch);
      await page.waitForFunction(() => window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
      await H.waitForTools(page);
    }
  };

  afterEach(async () => {
    const ctx = context;
    context = null;
    page = null;
    await H.closeContext(ctx).catch(() => null);
  });

  describe('in normal view', () => {
    // eslint-disable-next-line max-statements
    it('moves the toolbar by the mouse drag, docked left, and again once free', async () => {
      await openViewer(VIEWPORTS.desktop);
      assert.equal(await page.evaluate(() => getComputedStyle(window.Microdraw.dom.querySelector('#toolsDragHandle')).cursor), 'grab');
      let before = await panelRect(page);
      assert.equal(before.left - (await viewRect(page)).left, 5);
      await mouseDrag(page, await handleCentre(page));
      let after = await panelRect(page);
      assertMovedByDelta(before, after);
      assert.equal(await toolbarDisplay(page), 'free');

      before = after;
      await mouseDrag(page, await handleCentre(page), { x: -100, y: 50 });
      after = await panelRect(page);
      assertMovedByDelta(before, after, { x: -100, y: 50 });
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);

    it('moves the toolbar by the mouse drag, docked right', async () => {
      await openViewer(VIEWPORTS.desktop);
      await press(page, '#display-right');
      const before = await panelRect(page);
      assert.equal(before.right, (await viewRect(page)).right);
      await mouseDrag(page, await handleCentre(page), { x: -DELTA.x, y: DELTA.y });
      assertMovedByDelta(before, await panelRect(page), { x: -DELTA.x, y: DELTA.y });
    }).timeout(U.longTimeout);

    // eslint-disable-next-line max-statements
    it('keeps the toolbar inside the viewer at each edge', async () => {
      await openViewer(VIEWPORTS.desktop);
      // up and left
      await mouseDrag(page, await handleCentre(page), { x: -FAR, y: -FAR });
      let { p, v } = await assertInside(page);
      assert.closeTo(p.left, v.left, 0.5);
      assert.closeTo(p.top, v.top, 0.5);
      // down and right
      await mouseDrag(page, await handleCentre(page), { x: FAR, y: FAR });
      ({ p, v } = await assertInside(page));
      assert.closeTo(p.right, v.right, 0.5);
      assert.closeTo(p.bottom, v.bottom, 0.5);
      // the handle can still be grabbed
      await handleCentre(page);
    }).timeout(U.longTimeout);

    // eslint-disable-next-line max-statements
    it('remembers the position after a reload, and the dock buttons forget it', async () => {
      await openViewer(VIEWPORTS.desktop);
      assert.isNull(await stored(page));
      await mouseDrag(page, await handleCentre(page));
      const dropped = await panelRect(page);
      assert.isNotNull(await stored(page));

      await H.openData(page, U.url(DATA_URL));
      assert.equal(await toolbarDisplay(page), 'free');
      assert.deepEqual(await panelRect(page), dropped);

      // also on the next image
      await press(page, '#next');
      await H.waitForMicrodraw(page, 1);
      assert.deepEqual(await panelRect(page), dropped);

      await press(page, '#display-right');
      assert.equal(await toolbarDisplay(page), 'right');
      assert.equal((await panelRect(page)).right, (await viewRect(page)).right);
      assert.isNull(await stored(page));
      await H.openData(page, U.url(DATA_URL));
      assert.equal(await toolbarDisplay(page), 'left', 'docked as by default after a reload');
    }).timeout(U.longTimeout);

    it('clamps a remembered position that no longer fits the window', async () => {
      await openViewer(VIEWPORTS.desktop);
      await mouseDrag(page, await handleCentre(page), { x: FAR, y: FAR });
      await page.setViewport({ width: 900, height: 700 });
      await H.openData(page, U.url(DATA_URL));
      assert.equal(await toolbarDisplay(page), 'free');
      await assertInside(page);
    }).timeout(U.longTimeout);

    it('re-clamps the toolbar when the window gets smaller', async () => {
      await openViewer(VIEWPORTS.desktop);
      await mouseDrag(page, await handleCentre(page), { x: FAR, y: FAR });
      await page.setViewport({ width: 800, height: 750 });
      await page.waitForFunction(() => {
        const p = window.Microdraw.dom.querySelector('#menuBar').getBoundingClientRect();
        const v = window.Microdraw.dom.querySelector('#microdrawView').getBoundingClientRect();

        return p.right <= v.right + 0.5;
      }, { timeout: U.shortTimeout });
      await assertInside(page);
    }).timeout(U.longTimeout);

    it('moves the toolbar by a touch drag on a tablet, without scrolling the page', async () => {
      await openViewer(VIEWPORTS.tablet);
      const before = await panelRect(page);
      await touchDrag(page, await handleCentre(page));
      assertMovedByDelta(before, await panelRect(page));
      assert.equal(await toolbarDisplay(page), 'free');
      assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), [0, 0]);
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);
  });

  describe('in full screen', () => {
    it('moves the toolbar by the mouse drag', async () => {
      await openViewer(VIEWPORTS.desktop, { fullscreen: true });
      const before = await panelRect(page);
      await mouseDrag(page, await handleCentre(page));
      assertMovedByDelta(before, await panelRect(page));
      assert.equal(await toolbarDisplay(page), 'free');
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);

    it('moves the toolbar by a touch drag on a tablet', async () => {
      await openViewer(VIEWPORTS.tablet, { fullscreen: true });
      const before = await panelRect(page);
      await touchDrag(page, await handleCentre(page));
      assertMovedByDelta(before, await panelRect(page));
      assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), [0, 0]);
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);

    // eslint-disable-next-line max-statements
    it('keeps the toolbar inside the viewer when entering and leaving full screen', async () => {
      await openViewer(VIEWPORTS.desktop);
      // bottom right of the normal view, then full screen (a larger area)
      await mouseDrag(page, await handleCentre(page), { x: FAR, y: FAR });
      await press(page, '#fullscreen');
      await page.waitForFunction(() => window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
      await H.waitForTools(page);
      await assertInside(page);
      assert.equal(await toolbarDisplay(page), 'free');

      // bottom right of the full screen, then back to the normal view (smaller)
      await mouseDrag(page, await handleCentre(page), { x: FAR, y: FAR });
      await press(page, '#fullscreen');
      await page.waitForFunction(() => !window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
      await H.waitForTools(page);
      const { p, v } = await assertInside(page);
      assert.closeTo(p.right, v.right, 0.5);
      assert.equal(await toolbarDisplay(page), 'free');
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);

    it('docks the toolbar with the dock buttons', async () => {
      await openViewer(VIEWPORTS.desktop, { fullscreen: true });
      const docked = await panelRect(page);
      await mouseDrag(page, await handleCentre(page));
      await press(page, '#display-right');
      assert.equal(await toolbarDisplay(page), 'right');
      assert.equal((await panelRect(page)).right, VIEWPORTS.desktop.width);
      await press(page, '#display-left');
      assert.equal(await toolbarDisplay(page), 'left');
      assert.deepEqual(await panelRect(page), docked);
      assert.isNull(await stored(page));
    }).timeout(U.longTimeout);
  });

  describe('chat/script area height', () => {
    const blockHeight = () => page.evaluate(() => window.Microdraw.dom.querySelector('#textInputBlock').getBoundingClientRect().height);

    // eslint-disable-next-line max-statements
    it('follows a mouse drag of the strip at its bottom, down to 100 px', async () => {
      await openViewer(VIEWPORTS.desktop);
      const before = await blockHeight();
      await mouseDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: 80 });
      assert.closeTo(await blockHeight(), before + 80, 1);
      await mouseDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: -1000 });
      assert.equal(await blockHeight(), 100);
      // the message field is still there
      const msg = await rectOf(page, '#msg');
      const block = await rectOf(page, '#textInputBlock');
      assert.isAbove(msg.height, 0);
      assert.isAtMost(msg.top + msg.height, block.top + block.height);
    }).timeout(U.longTimeout);

    it('follows a touch drag on a tablet', async () => {
      await openViewer(VIEWPORTS.tablet, { fullscreen: true });
      const before = await blockHeight();
      await touchDrag(page, await centreOf(page, '#textInputResize'), { x: 0, y: -80 });
      assert.closeTo(await blockHeight(), before - 80, 1);
      assert.deepEqual(pageErrors, []);
    }).timeout(U.longTimeout);
  });
});
