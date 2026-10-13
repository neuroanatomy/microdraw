'use strict';
const UI = require('../UI');
const U = require('../../test/mocha.test.util');
const chai = require('chai');
var {assert} = chai;

// try {
//     require('puppeteer')
// } catch (e) {
//     console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`)
//     process.exit(1)
// }
const H = require('./helpers');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

let context;
let page;

const shadowclick = async function(sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

/*
  Expected values, recorded on 2026-10-11 by running these exact steps in a
  scratch probe (Chrome 116.0.5845.96, 800x600 viewport) and reading
  H.viewportState and the DOM; identical across two probe runs (up to 1e-13).

  Slice 0 of cat.json is 480x360 px and slice 1 is 2048x1024 px; both open at
  the same home zoom. Zoom in multiplies the zoom by 1.5 (tools/zoomIn.js) and
  zoom out divides it by 1.5. The pan drags the image right by width/6 px, so
  the viewport centre moves left by (width/6) / (width * zoom) viewport units.
*/
const HOME_ZOOM = 0.92;
const HOME_CENTRE = { x: 0.5, y: 0.375 };
const ZOOM_FACTOR = 1.5;
const SLICES = [{ width: 480, height: 360 }, { width: 2048, height: 1024 }];
const PAN_PX = U.width*2/3 - U.width/2;
const PANNED_CENTRE_X = HOME_CENTRE.x - PAN_PX/(U.width*HOME_ZOOM*ZOOM_FACTOR); // 0.3792 in the probe
const TOOLBAR = Object.entries(UI)
  .filter(([name]) => name !== 'CANVAS')
  .map(([, sel]) => sel);

let slice0Pixel;

// Element is displayed, not hidden, and has a non-empty box.
const visibleBox = (root, sel) => page.evaluate((r, s) => {
  const base = r === 'shadow' ? window.Microdraw.dom : document;
  const el = base.querySelector(s);
  if (!el) { return null; }
  const cs = getComputedStyle(el);
  const b = el.getBoundingClientRect();

  return {
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    text: el.textContent.trim(),
    placeholder: el.getAttribute('placeholder')
  };
}, root, sel);

// The Paper.js overlay follows the OSD viewport (Microdraw.transform).
const assertOverlayInSync = async (what) => {
  const s = await page.evaluate(() => {
    const M = window.Microdraw;
    const v = M.viewer.viewport;
    const b = v.getBounds(true);

    return {
      zoom: window.paper.view.zoom,
      expectedZoom: M.viewer.source.width*v.viewportToImageZoom(v.getZoom(true))/M.magicV,
      centre: [window.paper.view.center.x, window.paper.view.center.y],
      expectedCentre: [M.magicV*(b.x + (b.width/2)), M.magicV*(b.y + (b.height/2))]
    };
  });
  assert.approximately(s.zoom, s.expectedZoom, 1e-6, `${what}: overlay zoom ${s.zoom}, viewport needs ${s.expectedZoom}`);
  s.centre.forEach((c, i) => assert.approximately(c, s.expectedCentre[i], 1e-6, `${what}: overlay centre ${s.centre}, viewport needs ${s.expectedCentre}`));
};

// eslint-disable-next-line max-statements
const assertSlice = async (index) => {
  const vp = await H.viewportState(page);
  assert.equal(vp.slice, index, 'slice index');
  assert.equal(vp.sliceCount, 2);
  assert.equal(vp.imageWidth, SLICES[index].width, 'image width');
  assert.equal(vp.imageHeight, SLICES[index].height, 'image height');
  assert.isTrue(vp.fullyLoaded, 'image tiles not fully loaded');
  assert.approximately(vp.zoom, HOME_ZOOM, 1e-6, 'zoom');
  assert.approximately(vp.centre.x, HOME_CENTRE.x, 1e-6, 'centre x');
  assert.approximately(vp.centre.y, HOME_CENTRE.y, 1e-6, 'centre y');
  const ui = await page.evaluate(() => ({
    text: window.Microdraw.dom.querySelector('#slice-number').textContent,
    slider: window.Microdraw.dom.querySelector('#slice').dataset.val,
    url: new URLSearchParams(location.search).get('slice')
  }));
  assert.deepEqual(ui, { text: `Slice ${index}`, slider: String(index), url: String(index) });
  await assertOverlayInSync(`slice ${index}`);
};

const assertView = async (zoom, centreX, what) => {
  const vp = await H.viewportState(page);
  assert.approximately(vp.zoom, zoom, 1e-6, `${what}: zoom`);
  assert.approximately(vp.centre.x, centreX, 1e-6, `${what}: centre x`);
  assert.approximately(vp.centre.y, HOME_CENTRE.y, 1e-6, `${what}: centre y`);
  assert.isTrue(vp.fullyLoaded, `${what}: image tiles not fully loaded`);
  assert.equal(vp.slice, 0, `${what}: slice`);
  await assertOverlayInSync(what);
};

describe('View pages and data', () => {
  before(async () => {
    context = await H.newContext();
  });

  // eslint-disable-next-line max-statements
  it('shows the landing page', async () => {
    page = await context.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await page.goto(U.url(''), { waitUntil: 'load' });

    assert.equal(await page.title(), 'MicroDraw');
    const [logo, url, list, go, footer] = await Promise.all(['#logo', '#url', '#list', '#go', '#footer'].map((sel) => visibleBox('document', sel)));
    for (const [el, sel] of [[logo, '#logo'], [url, '#url'], [list, '#list'], [go, '#go'], [footer, '#footer']]) {
      assert.exists(el, `${sel} is missing`);
      assert.isTrue(el.visible, `${sel} is not visible`);
    }
    // layout, independent of font metrics: logo and URL field centred, the
    // dataset list and Go side by side under the URL field, footer full width below
    assert.approximately(logo.x + (logo.width/2), U.width/2, 2, 'logo is not centred');
    assert.approximately(url.x + (url.width/2), U.width/2, 2, 'URL field is not centred');
    assert.approximately(url.width, 600, 2, 'URL field width');
    assert.isAbove(url.y, logo.y + logo.height, 'URL field is not below the logo');
    assert.isAtLeast(list.y, url.y + url.height, 'dataset list is not below the URL field');
    assert.approximately(go.y, list.y, 2, 'Go is not on the same row as the dataset list');
    assert.isAbove(go.x, list.x + list.width - 1, 'Go is not right of the dataset list');
    assert.equal(go.text, 'Go');
    assert.equal(url.placeholder, 'Enter a DeepZoom image URL and click Go');
    assert.approximately(footer.width, U.width, 1, 'footer is not full width');
    assert.isAbove(footer.y, go.y + go.height, 'footer is not below the controls');
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('shows test data, first page', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await H.settleFrames(page);

    await assertSlice(0);
    for (const sel of TOOLBAR) {
      // eslint-disable-next-line no-await-in-loop
      const el = await visibleBox('shadow', sel);
      assert.exists(el, `${sel} is missing`);
      assert.isTrue(el.visible, `${sel} is not visible`);
    }
    // the image is drawn (loose: opaque, not blank white)
    slice0Pixel = await H.samplePixel(page, 'osd', U.width/2, U.height/2);
    assert.equal(slice0Pixel[3], 255, `image pixel ${slice0Pixel} is not opaque`);
    assert.isBelow(slice0Pixel[0] + slice0Pixel[1] + slice0Pixel[2], 3*250, `image pixel ${slice0Pixel} is blank`);
  }).timeout(U.shortTimeout);

  it('can go to the next page', async () => {
    await shadowclick(UI.NEXT);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await H.waitForMicrodraw(page, 1);
    await H.settleFrames(page);

    await assertSlice(1);
    const px = await H.samplePixel(page, 'osd', U.width/2, U.height/2);
    assert.equal(px[3], 255, `image pixel ${px} is not opaque`);
    assert.notDeepEqual(px, slice0Pixel, 'the image did not change');
  }).timeout(U.shortTimeout);

  it('can go back to the previous page', async () => {
    await shadowclick(UI.PREVIOUS);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await H.waitForMicrodraw(page, 0);
    await H.settleFrames(page);

    await assertSlice(0);
    assert.deepEqual(await H.samplePixel(page, 'osd', U.width/2, U.height/2), slice0Pixel, 'not the first image again');
  }).timeout(U.shortTimeout);

  it('can zoom in', async () => {
    await shadowclick(UI.ZOOMIN);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await H.waitForViewport(page);
    await H.settleFrames(page);

    await assertView(HOME_ZOOM*ZOOM_FACTOR, HOME_CENTRE.x, 'zoomed in');
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('can translate', async () => {
    await shadowclick(UI.NAVIGATE);

    await page.mouse.move(U.width/2, U.height/2);
    await page.mouse.down();
    await page.mouse.move(U.width*2/3, U.height/2, {steps:50});
    await page.mouse.up();
    await page.waitForFunction('Microdraw.isAnimating === false');
    await H.waitForViewport(page);
    await H.settleFrames(page);

    await assertView(HOME_ZOOM*ZOOM_FACTOR, PANNED_CENTRE_X, 'panned');
  }).timeout(U.mediumTimeout);

  it('can zoom out', async () => {
    await shadowclick(UI.ZOOMOUT);
    // waitForViewport waits for the zoom animation to finish and the tiles to load
    await H.waitForViewport(page);
    await H.settleFrames(page);

    await assertView(HOME_ZOOM, PANNED_CENTRE_X, 'zoomed out');
  }).timeout(U.shortTimeout);

  after(async () => {
    await H.closeContext(context);
  });
});
