'use strict';
const UI = require('../UI');
const U = require('../mocha.test.util');
const chai = require('chai');
var {assert} = chai;

// try {
//     require('puppeteer')
// } catch (e) {
//     console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`)
//     process.exit(1)
// }
const { launchBrowser } = require('./browser');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

let browser;
let page;

const shadowclick = async function (sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

/*
  Expected values, recorded on 2026-10-11 by running these exact steps in a
  scratch probe (Chrome 116.0.5845.96, 800x600 viewport, cat.json slice 0) and
  reading U.regionState; identical across two probe runs.

  Splitting E with F divides E into the part outside F (6 segments, three
  quarters of E) and the part inside F (4 segments, one quarter), and removes
  both E and F. F is used as a knife: removing it is intended (maintainer,
  2026-10-11, D23), so after the split nothing covers the F-only area.
*/
const HOME_ZOOM = 0.92;
// Bounds on the page, in px: [x, y, width, height]
const SQUARE_E = [400, 400, 100, 100];
const SQUARE_F = [450, 450, 100, 100];
const E_OUTSIDE_F = { segments: 6, bounds: SQUARE_E, areaOfE: 0.75 };
const E_INSIDE_F = { segments: 4, bounds: [450, 450, 50, 50], areaOfE: 0.25 };
const BOUNDS_TOLERANCE = 2; // px
const AREA_TOLERANCE = 0.01; // fraction of E's area

// Where to sample the annotation canvas
const AT = {
  eOnly: [420, 420],
  overlap: [475, 475],
  fOnly: [530, 530],
  outside: [300, 300]
};

let areaE;

const assertBounds = (actual, expected, what) => {
  const got = [actual.x, actual.y, actual.width, actual.height];
  got.forEach((v, i) => {
    assert.approximately(v, expected[i], BOUNDS_TOLERANCE, `${what}: bounds [x, y, w, h] are ${got.map(Math.round)}, expected ${expected}`);
  });
};

const assertSquare = (region, bounds, what) => {
  assert.equal(region.segments, 4, `${what}: segments`);
  assert.equal(region.curvedSegments, 0, `${what}: a polygon has no curves`);
  assert.isTrue(region.closed, `${what}: not closed`);
  assertBounds(region.viewBounds, bounds, what);
};

// The pixel at `where` shows `regions` (bottom first) with their own fills; [] means transparent.
const assertPixelShows = async (where, regions) => {
  const px = await U.samplePixel(page, 'paper', ...AT[where]);
  const expected = U.expectedFillPixel(regions);
  px.forEach((v, i) => {
    assert.approximately(v, expected[i], 3, `${where}: pixel ${px}, expected ${expected}`);
  });
};

describe('Editing tools: split regions', () => {
  // eslint-disable-next-line max-statements
  it('opens a data page', async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await U.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await U.settleFrames(page);
    await page.screenshot({path: U.newPath + 'split.01.cat.png'});

    const vp = await U.viewportState(page);
    assert.equal(vp.slice, 0);
    assert.equal(vp.sliceCount, 2);
    assert.isTrue(vp.fullyLoaded, 'image tiles not fully loaded');
    assert.approximately(vp.zoom, HOME_ZOOM, 1e-6);
    assert.lengthOf(await U.regionState(page), 0);

    // the image is drawn (loose: opaque, not blank white); no annotation over it
    const img = await U.samplePixel(page, 'osd', ...AT.overlap);
    assert.equal(img[3], 255, `image pixel ${img} is not opaque`);
    assert.isBelow(img[0] + img[1] + img[2], 3*250, `image pixel ${img} is blank`);
    await assertPixelShows('overlap', []);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a square', async () => {
    await shadowclick(UI.DRAWPOLYGON);
    await page.mouse.click(400, 400);
    await page.mouse.click(500, 400);
    await page.mouse.click(500, 500);
    await page.mouse.click(400, 500);
    await page.mouse.click(400, 400);

    await U.settleFrames(page);
    const filename = "split.02.cat-square-E.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 1);
    const [e] = regions;
    assertSquare(e, SQUARE_E, 'square E');
    assert.isTrue(e.isCurrent && e.selected, 'square E is not selected');
    assert.equal(e.fillAlpha, 0.5);
    areaE = e.area;

    await assertPixelShows('eOnly', [e]);
    await assertPixelShows('overlap', [e]);
    await assertPixelShows('fOnly', []);
    await assertPixelShows('outside', []);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws another square', async () => {
    await page.mouse.click(450, 450);
    await page.mouse.click(550, 450);
    await page.mouse.click(550, 550);
    await page.mouse.click(450, 550);
    await page.mouse.click(450, 450);

    await U.settleFrames(page);
    const filename = "split.03.cat-square-F.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 2);
    const [e, f] = regions;
    assertSquare(e, SQUARE_E, 'square E');
    assertSquare(f, SQUARE_F, 'square F');
    assert.isTrue(f.isCurrent && f.selected, 'square F is not selected');
    assert.isFalse(e.selected, 'square E is still selected');
    assert.isAbove(f.index, e.index, 'F is not drawn above E');

    await assertPixelShows('eOnly', [e]);
    await assertPixelShows('overlap', [e, f]);
    await assertPixelShows('fOnly', [f]);
    await assertPixelShows('outside', []);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('split square E using square F', async () => {
    await shadowclick(UI.SPLITREGION);

    // click on square E (square F is already selected)
    await page.mouse.click(405, 405);

    await U.settleFrames(page);
    const filename = "split.04.cat-split.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 2, 'E should become two pieces, and F should be gone');
    const outside = regions.find((reg) => reg.segments === E_OUTSIDE_F.segments);
    const inside = regions.find((reg) => reg.segments === E_INSIDE_F.segments);
    assert.exists(outside, `no ${E_OUTSIDE_F.segments}-segment piece (E outside F); segments are ${regions.map((reg) => reg.segments)}`);
    assert.exists(inside, `no ${E_INSIDE_F.segments}-segment piece (E inside F); segments are ${regions.map((reg) => reg.segments)}`);
    for (const [piece, want, what] of [[outside, E_OUTSIDE_F, 'E outside F'], [inside, E_INSIDE_F, 'E inside F']]) {
      assert.isTrue(piece.closed, `${what}: not closed`);
      assert.equal(piece.curvedSegments, 0, `${what}: a polygon has no curves`);
      assertBounds(piece.viewBounds, want.bounds, what);
      assert.approximately(piece.area/areaE, want.areaOfE, AREA_TOLERANCE, `${what}: area is ${(piece.area/areaE).toFixed(3)} of E`);
    }

    await assertPixelShows('eOnly', [outside]);
    // a single layer now: the overlap belongs to one piece, not to E and F stacked
    await assertPixelShows('overlap', [inside]);
    // F was the knife and is removed by the split (see the comment at the top)
    await assertPixelShows('fOnly', []);
    await assertPixelShows('outside', []);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
