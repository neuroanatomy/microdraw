/* global Microdraw */
'use strict';

/*
  The viewer's floating panels (labels, layers, text annotation) are
  nwl-components' .nwl-panel (3.2.0): a header that stays and a body that
  scrolls. Made short, so that their body scrolls, each keeps its header at its
  top after scrolling to the bottom; the labels and layers panels are still
  dragged by their header and resizable; each opens and closes as before.
  (Before, the whole panel scrolled and its header went with it.)
  Resized by its bottom-right corner, a panel keeps its top-left corner in place,
  and a drag still follows the pointer: centred by a transform at rest, it is
  pinned by its top-left corner at the first press (nwl-components floatingPanel).
  (Before, centred by translate(-50%, -50%), it grew in every direction.)
  The labels and layers panels are resized by nwl-components' resize handle
  (3.3.0), with a finger on a tablet as with the mouse, and their native
  `resize` is off. (Before, `resize: both`: iOS and iPadOS draw no resize
  corner, so a finger couldn't resize them.)
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';
const DELTA = { x: 60, y: 40 };
const GROW = { width: 50, height: 30 };
const TABLET = { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const HANDLE = ':scope > .nwl-panel-resize-handle';

const PANELS = {
  labels: { panel: '#labelset-panel', header: '#labelset-header', close: '#labels-close', open: () => window.ToolColor.color.click('select'), drag: true },
  layers: { panel: '#layers-panel', header: '#layers-header', close: '#layers-close', open: () => Microdraw.tools.layers.click('select'), drag: true },
  'text annotation': { panel: '#text-annotation-panel', header: '#header', close: '#text-annotation-close', open: () => Microdraw.tools.textAnnotation.mouseDown([100, 100]), drag: false }
};

let context;
let page;
const errors = [];

// in the page: the panel made `height` high and its body scrolled to the bottom
const scrolledToBottom = (p, height) => page.evaluate(({ panel: sel, header: headerSel }, h) => {
  const panel = Microdraw.dom.querySelector(sel);
  const body = panel.querySelector(':scope > .nwl-panel-body');
  panel.style.height = h;
  const overflows = body.scrollHeight > body.clientHeight;
  body.scrollTop = body.scrollHeight;
  const [pr, hr, br] = [panel, panel.querySelector(headerSel), body].map((el) => el.getBoundingClientRect());
  const result = {
    ...(({ display, resize }) => ({ display, resize }))(getComputedStyle(panel)),
    handle: panel.querySelectorAll(':scope > .nwl-panel-resize-handle').length,
    overflows,
    scrolled: body.scrollTop > 0,
    panelScroll: panel.scrollTop,
    headerTop: Math.round(hr.top - pr.top),
    headerBelowBody: hr.bottom > br.top + 0.5
  };
  body.scrollTop = 0;
  panel.style.height = '';

  return result;
}, p, height);

const rectOf = (sel) => page.evaluate((s) => {
  const { left, top } = Microdraw.dom.querySelector(s).getBoundingClientRect();

  return { left, top };
}, sel);

// a point of the header that is the header itself (its padding, left of its title)
const headerPoint = (sel) => page.evaluate((s) => {
  const header = Microdraw.dom.querySelector(s);
  const r = header.getBoundingClientRect();
  const [x, y] = [r.left + 4, r.top + 4];

  return { x, y, isHeader: Microdraw.dom.elementFromPoint(x, y) === header };
}, sel);

const scrollBody = (sel) => page.evaluate((s) => {
  const body = Microdraw.dom.querySelector(s).querySelector(':scope > .nwl-panel-body');
  body.scrollTop = body.scrollHeight;
}, sel);

const mouseDrag = async (from, delta) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 4 });
  await page.mouse.up();
};

const sizeOf = (sel) => page.evaluate((s) => {
  const { left, top, width, height } = Microdraw.dom.querySelector(s).getBoundingClientRect();

  return { left, top, width, height };
}, sel);

const round = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]));

// the centre of the panel's resize handle (bottom-right), and whether nothing covers it
const handleCentre = (sel) => page.evaluate((s, h) => {
  const handle = Microdraw.dom.querySelector(s).querySelector(h);
  const r = handle.getBoundingClientRect();
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];

  return { x, y, isHandle: Microdraw.dom.elementFromPoint(x, y) === handle };
}, sel, HANDLE);

// the panel's resize handle, pulled with the mouse by `delta`
const pullCorner = async (sel, delta) => {
  const from = await handleCentre(sel);
  assert.isTrue(from.isHandle, 'nothing covers the resize handle');
  await mouseDrag(from, { x: delta.width, y: delta.height });
};

const displayOf = (sel) => page.evaluate((s) => getComputedStyle(Microdraw.dom.querySelector(s)).display, sel);

describe('The viewer\'s floating panels keep their header while they scroll (nwl-components 3.2.0)', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, U.url(DATA_URL));
    await page.waitForFunction(() => Microdraw.ontology && Microdraw.ontology.labels, { polling: 50, timeout: U.shortTimeout });
  });

  after(async () => {
    await H.closeContext(context);
  });

  afterEach(async () => {
    // every panel closed, back at its place
    await page.evaluate((all) => all.forEach((s) => {
      const panel = Microdraw.dom.querySelector(s);
      panel.style.display = 'none';
      ['left', 'top', 'right', 'bottom', 'width', 'height', 'transform'].forEach((k) => { panel.style[k] = ''; });
    }), Object.values(PANELS).map((p) => p.panel));
  });

  Object.entries(PANELS).forEach(([name, p]) => {
    it(`${name}: the header stays at the top after the short panel's body is scrolled to the bottom`, async () => {
      await page.evaluate(p.open);
      const r = await scrolledToBottom(p, name === 'text annotation' ? '90px' : '120px');
      assert.equal(r.display, 'flex');
      assert.isTrue(r.overflows, 'the body is taller than the short panel');
      assert.isTrue(r.scrolled, 'the body scrolls');
      assert.equal(r.panelScroll, 0, 'the panel itself does not scroll');
      assert.equal(r.headerTop, 1, 'the header at the top, inside the panel\'s 1px border');
      assert.isFalse(r.headerBelowBody, 'the body starts below the header');
      // the labels and layers panels have nwl-components' resize handle, and no native resize
      assert.equal(r.resize, 'none');
      assert.equal(r.handle, p.drag ? 1 : 0);
    }).timeout(U.longTimeout);

    it(`${name}: closes with its close button and opens again`, async () => {
      await page.evaluate(p.open);
      assert.equal(await displayOf(p.panel), 'flex');
      await (await page.evaluateHandle((s) => Microdraw.dom.querySelector(s), p.close)).click();
      assert.equal(await displayOf(p.panel), 'none');
      await page.evaluate(p.open);
      assert.equal(await displayOf(p.panel), 'flex');
    }).timeout(U.longTimeout);

    if (p.drag) {
      it(`${name}: dragged by its header, with the mouse, after its body has scrolled`, async () => {
        await page.evaluate(p.open);
        await scrollBody(p.panel);
        const before = await rectOf(p.panel);
        const from = await headerPoint(p.header);
        assert.isTrue(from.isHeader, 'nothing covers the header');
        await mouseDrag(from, DELTA);
        const after = await rectOf(p.panel);
        assert.deepEqual({ x: Math.round(after.left - before.left), y: Math.round(after.top - before.top) }, DELTA);
      }).timeout(U.longTimeout);

      it(`${name}: resized by its handle with the mouse, its top-left corner stays; then dragged, it follows the pointer`, async () => {
        await page.evaluate(p.open);
        const before = round(await sizeOf(p.panel));
        await pullCorner(p.panel, GROW);
        const resized = round(await sizeOf(p.panel));
        assert.deepEqual({ left: resized.left, top: resized.top }, { left: before.left, top: before.top }, 'the top-left corner stays');
        assert.deepEqual({ width: resized.width - before.width, height: resized.height - before.height }, GROW, 'it grows by the pull');
        await mouseDrag(await headerPoint(p.header), DELTA);
        const dragged = round(await sizeOf(p.panel));
        assert.deepEqual({ x: dragged.left - resized.left, y: dragged.top - resized.top }, DELTA, 'the drag follows the pointer');
        assert.deepEqual({ width: dragged.width, height: dragged.height }, { width: resized.width, height: resized.height });
      }).timeout(U.longTimeout);
    }
  });

  it('no page errors', () => {
    assert.deepEqual(errors, []);
  });
});

// a finger's drag from `from` by `delta`, in steps
const touchDrag = async (from, delta) => {
  await page.touchscreen.touchStart(from.x, from.y);
  for (let i = 1; i <= 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.touchscreen.touchMove(from.x + delta.width * i / 8, from.y + delta.height * i / 8);
  }
  await page.touchscreen.touchEnd();
};

describe('On a tablet, a finger resizes the floating panels by their handle (nwl-components 3.3.0)', () => {
  const tabletErrors = [];

  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => tabletErrors.push(err.message));
    await page.setViewport(TABLET);
    await H.openData(page, U.url(DATA_URL));
    await page.waitForFunction(() => Microdraw.ontology && Microdraw.ontology.labels, { polling: 50, timeout: U.shortTimeout });
  });

  after(async () => {
    await H.closeContext(context);
  });

  Object.entries(PANELS).filter(([, p]) => p.drag)
    .forEach(([name, p]) => {
      it(`${name}: a finger's drag on its handle resizes it, its top-left corner stays; no native resize`, async () => {
        await page.evaluate(p.open);
        const before = round(await sizeOf(p.panel));
        const from = await handleCentre(p.panel);
        assert.isTrue(from.isHandle, 'nothing covers the resize handle');
        await touchDrag(from, GROW);
        const resized = round(await sizeOf(p.panel));
        assert.deepEqual({ left: resized.left, top: resized.top }, { left: before.left, top: before.top }, 'the top-left corner stays');
        assert.deepEqual({ width: resized.width - before.width, height: resized.height - before.height }, GROW, 'it grows by the drag');
        assert.equal(await page.evaluate((s) => getComputedStyle(Microdraw.dom.querySelector(s)).resize, p.panel), 'none');
        await page.evaluate((s) => { Microdraw.dom.querySelector(s).style.display = 'none'; }, p.panel);
      }).timeout(U.longTimeout);
    });

  it('no page errors', () => {
    assert.deepEqual(tabletErrors, []);
  });
});
