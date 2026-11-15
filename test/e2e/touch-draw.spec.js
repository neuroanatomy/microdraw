'use strict';

/*
  Drawing with a finger (2026-11-15): on an iPad in full screen, draw and
  drawPolygon drew away from the finger, off the screen. The viewer took the pointer's place from the event's non-standard
  layerX/layerY, which iOS Safari doesn't give reliably for touch; it now uses
  OpenSeadragon's event.position, worked out the same way in every browser.
  Chrome's own layerX is right, so each test makes it read 0, as a browser
  without it would: the regions must still be drawn where the finger went.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const TABLET = { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

describe('Drawing with a finger (touch)', () => {
  let context;
  let page;

  // the viewer's middle, in page px, and the paper canvas's top left
  const geometry = () => page.evaluate(() => {
    const v = window.Microdraw.dom.querySelector('#microdrawView').getBoundingClientRect();
    const c = window.paper.view.element.getBoundingClientRect();

    return { x: v.left + (v.width / 2), y: v.top + (v.height / 2), canvas: { left: c.left, top: c.top } };
  });
  // the last region's bounds, in page px
  const lastRegion = () => page.evaluate(() => {
    const regions = window.Microdraw.ImageInfo[window.Microdraw.currentImage].Regions;
    const reg = regions[regions.length - 1];
    if (!reg) { return null; }
    const c = window.paper.view.element.getBoundingClientRect();
    const tl = window.paper.view.projectToView(reg.path.bounds.topLeft);
    const br = window.paper.view.projectToView(reg.path.bounds.bottomRight);

    return { count: regions.length, left: tl.x + c.left, top: tl.y + c.top, right: br.x + c.left, bottom: br.y + c.top, closed: reg.path.closed };
  });
  const tapTool = async (id) => {
    await (await page.evaluateHandle((s) => window.Microdraw.dom.querySelector(s), `#${id}`)).tap();
    assert.equal(await page.evaluate(() => window.Microdraw.selectedTool), id);
  };
  const tap = async (x, y) => {
    await page.touchscreen.touchStart(x, y);
    await page.touchscreen.touchEnd();
  };

  beforeEach(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport(TABLET);
    await H.openData(page, U.url(DATA_URL));
    // as a browser whose layerX/layerY can't be trusted
    await page.evaluate(() => {
      for (const P of [window.UIEvent.prototype, window.MouseEvent.prototype]) {
        Object.defineProperty(P, 'layerX', { configurable: true, get: () => 0 });
        Object.defineProperty(P, 'layerY', { configurable: true, get: () => 0 });
      }
    });
  });

  afterEach(async () => {
    const ctx = context;
    context = null;
    page = null;
    await H.closeContext(ctx).catch(() => null);
  });

  // eslint-disable-next-line max-statements -- one gesture, then its region checked
  it('draw: a finger drag draws a region where the finger went', async () => {
    await tapTool('draw');
    const g = await geometry();
    await page.touchscreen.touchStart(g.x, g.y);
    for (let i = 1; i <= 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      await page.touchscreen.touchMove(g.x + (15 * i), g.y + (10 * i));
    }
    await page.touchscreen.touchEnd();
    const r = await lastRegion();
    assert.isNotNull(r, 'a region is drawn');
    assert.closeTo(r.left, g.x, 6, 'starts where the finger went down');
    assert.closeTo(r.top, g.y, 6);
    assert.closeTo(r.right, g.x + 120, 6, 'ends where the finger went up');
    assert.closeTo(r.bottom, g.y + 80, 6);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one gesture, then its region checked
  it('drawPolygon: taps add points where the finger went, a tap on the first closes it', async () => {
    await tapTool('drawPolygon');
    const g = await geometry();
    const points = [[g.x, g.y], [g.x + 150, g.y], [g.x + 75, g.y + 100]];
    for (const [x, y] of points) {
      // eslint-disable-next-line no-await-in-loop
      await tap(x, y);
    }
    await tap(points[0][0], points[0][1]);
    const r = await lastRegion();
    assert.isNotNull(r, 'a region is drawn');
    assert.isTrue(r.closed, 'closed by the tap on its first point');
    assert.closeTo(r.left, g.x, 6);
    assert.closeTo(r.top, g.y, 6);
    assert.closeTo(r.right, g.x + 150, 6);
    assert.closeTo(r.bottom, g.y + 100, 6);
  }).timeout(U.longTimeout);
});

// In full screen on an iPad the drawing came out up and to the left of the
// pointer, off the screen (maintainer, 2026-11-15): Safari measures layerX/Y
// from another box there. Chrome's are right, so these pass with the old code
// too; they keep full screen drawing where the pointer is.
describe('Drawing in full screen, where the pointer is', () => {
  let context;
  let page;

  const open = async (viewport) => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport(viewport);
    await H.openData(page, U.url(DATA_URL));
    const button = await page.evaluateHandle(() => window.Microdraw.dom.querySelector('#fullscreen'));
    await (viewport.hasTouch ? button.tap() : button.click());
    await page.waitForFunction(() => window.Microdraw.isFullscreen(), { timeout: U.shortTimeout });
    await H.waitForTools(page);
  };
  // the viewer's middle in page px, and the last region's top left in page px
  const middle = () => page.evaluate(() => {
    const v = window.Microdraw.dom.querySelector('#microdrawView').getBoundingClientRect();

    return { x: v.left + (v.width / 2), y: v.top + (v.height / 2) };
  });
  const regionTopLeft = () => page.evaluate(() => {
    const regions = window.Microdraw.ImageInfo[window.Microdraw.currentImage].Regions;
    const reg = regions[regions.length - 1];
    if (!reg) { return null; }
    const c = window.paper.view.element.getBoundingClientRect();
    const tl = window.paper.view.projectToView(reg.path.bounds.topLeft);

    return { x: tl.x + c.left, y: tl.y + c.top };
  });
  const selectDraw = async (touch) => {
    const tool = await page.evaluateHandle(() => window.Microdraw.dom.querySelector('#draw'));
    await (touch ? tool.tap() : tool.click());
  };

  afterEach(async () => {
    const ctx = context;
    context = null;
    page = null;
    await H.closeContext(ctx).catch(() => null);
  });

  // eslint-disable-next-line max-statements -- one gesture, then its region checked
  it('a finger drag draws where the finger went', async () => {
    await open(TABLET);
    await selectDraw(true);
    const m = await middle();
    await page.touchscreen.touchStart(m.x, m.y);
    for (let i = 1; i <= 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      await page.touchscreen.touchMove(m.x + (15 * i), m.y + (10 * i));
    }
    await page.touchscreen.touchEnd();
    const r = await regionTopLeft();
    assert.isNotNull(r, 'a region is drawn');
    assert.closeTo(r.x, m.x, 6);
    assert.closeTo(r.y, m.y, 6);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one gesture, then its region checked
  it('a mouse drag draws where the mouse went', async () => {
    await open({ width: 1200, height: 900 });
    await selectDraw(false);
    const m = await middle();
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m.x + 120, m.y + 80, { steps: 8 });
    await page.mouse.up();
    const r = await regionTopLeft();
    assert.isNotNull(r, 'a region is drawn');
    assert.closeTo(r.x, m.x, 6);
    assert.closeTo(r.y, m.y, 6);
  }).timeout(U.longTimeout);
});
