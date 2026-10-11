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

  The star here closes normally: 11 clicks 36 degrees apart, the last one on
  the first point, give one closed 10-segment polygon.
  toBezier smooths it: the same 10 segments, every one with handles, and an
  area about 14% smaller (the curves cut inside the polygon's corners).
  toPolygon clears the handles: the same 10 points, so exactly the polygon again.
*/
const HOME_ZOOM = 0.92;
const STAR_SEGMENTS = 10;
// Bounds on the page, in px: [x, y, width, height]
const STAR_VIEW_BOUNDS = [333, 109, 362, 381];
const BEZIER_VIEW_BOUNDS = [333, 109, 362.2, 381.1];
const BOUNDS_TOLERANCE = 2; // px
const BEZIER_AREA_OF_STAR = 0.859; // 93457 / 108748 in the probe
const AREA_TOLERANCE = 0.01;

// The star: centre o, radius r.
const o = [U.width*2/3, U.height/2];
const r = U.width/4;

// Pixels that tell the polygon from the curve: inside the polygon but outside
// the smoothed curve, each at least 5 px from both outlines (found in the probe
// by testing a 4 px grid against both paths). Points such as the centre or
// the far left are the same in all three states, so they only check the fill.
const CUT_BY_CURVE = [[464, 192], [624, 400], [652, 252]];
const ALWAYS_INSIDE = o;
const ALWAYS_OUTSIDE = [100, U.height/2];

let starArea;

const assertBounds = (actual, expected, what) => {
  const got = [actual.x, actual.y, actual.width, actual.height];
  got.forEach((v, i) => {
    assert.approximately(v, expected[i], BOUNDS_TOLERANCE, `${what}: bounds [x, y, w, h] are ${got.map(Math.round)}, expected ${expected}`);
  });
};

// The pixel at [x, y] shows `regions` (bottom first) with their own fills; [] means transparent.
const assertPixelShows = async ([x, y], regions, where) => {
  const px = await U.samplePixel(page, 'paper', x, y);
  const expected = U.expectedFillPixel(regions);
  px.forEach((v, i) => {
    assert.approximately(v, expected[i], 3, `${where} at ${x},${y}: pixel ${px}, expected ${expected}`);
  });
};

const onlyRegion = async () => {
  const regions = await U.regionState(page);
  assert.lengthOf(regions, 1);
  const [star] = regions;
  assert.equal(star.segments, STAR_SEGMENTS);
  assert.isTrue(star.closed, 'the star is not closed');
  assert.isTrue(star.isCurrent, 'the star is not the selected region');

  return star;
};

const assertPolygon = async (star, what) => {
  assert.equal(star.curvedSegments, 0, `${what}: every handle should be zero`);
  assertBounds(star.viewBounds, STAR_VIEW_BOUNDS, what);
  await assertPixelShows(ALWAYS_INSIDE, [star], `${what}, inside`);
  await assertPixelShows(ALWAYS_OUTSIDE, [], `${what}, outside`);
  for (const pt of CUT_BY_CURVE) {
    // eslint-disable-next-line no-await-in-loop
    await assertPixelShows(pt, [star], `${what}, corner that the curve cuts`);
  }
};

describe('Editing tools: convert polygons to bézier and vice-versa', () => {
  // eslint-disable-next-line max-statements
  it('opens a data page', async () => {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await U.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await U.settleFrames(page);
    await page.screenshot({path: U.newPath + 'toBezierPolygon.01.cat.png'});

    const vp = await U.viewportState(page);
    assert.equal(vp.slice, 0);
    assert.equal(vp.sliceCount, 2);
    assert.isTrue(vp.fullyLoaded, 'image tiles not fully loaded');
    assert.approximately(vp.zoom, HOME_ZOOM, 1e-6);
    assert.lengthOf(await U.regionState(page), 0);

    // the image is drawn (loose: opaque, not blank white); no annotation over it
    const img = await U.samplePixel(page, 'osd', ...o);
    assert.equal(img[3], 255, `image pixel ${img} is not opaque`);
    assert.isBelow(img[0] + img[1] + img[2], 3*250, `image pixel ${img} is blank`);
    await assertPixelShows(o, [], 'annotation canvas');
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a star polygon', async () => {
    // select the polygon tool
    await shadowclick(UI.DRAWPOLYGON);

    for(let a=0; a<=360; a+=36) {
      const r1 = r*(1-0.5*(a%72===0));
      const x = o[0] + r1*Math.cos(a*Math.PI/180);
      const y = o[1] + r1*Math.sin(a*Math.PI/180);
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(x, y);
    }

    await U.settleFrames(page);
    const filename = "toBezierPolygon.02.cat-star.png";
    await page.screenshot({path: U.newPath + filename});

    const star = await onlyRegion();
    assert.equal(star.fillAlpha, 0.5);
    starArea = star.area;
    await assertPolygon(star, 'star');
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('converts the star polygon to a bézier curve', async () => {
    await shadowclick(UI.TOBEZIER);

    await U.waitForTools(page);
    await U.settleFrames(page);
    const filename = "toBezierPolygon.03.cat-star-toBezier.png";
    await page.screenshot({path: U.newPath + filename});

    const star = await onlyRegion();
    assert.equal(star.curvedSegments, STAR_SEGMENTS, 'every segment should have handles');
    assertBounds(star.viewBounds, BEZIER_VIEW_BOUNDS, 'bézier star');
    assert.approximately(star.area/starArea, BEZIER_AREA_OF_STAR, AREA_TOLERANCE, `bézier area is ${(star.area/starArea).toFixed(3)} of the polygon's`);
    await assertPixelShows(ALWAYS_INSIDE, [star], 'bézier star, inside');
    await assertPixelShows(ALWAYS_OUTSIDE, [], 'bézier star, outside');
    for (const pt of CUT_BY_CURVE) {
      // eslint-disable-next-line no-await-in-loop
      await assertPixelShows(pt, [], 'bézier star, corner that the curve cuts');
    }
  }).timeout(0);

  it('converts the star bézier back to a polygon', async () => {
    // conversion to polygon has to be confirmed through a dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await shadowclick(UI.TOPOLYGON);

    await U.settleFrames(page);
    const filename = "toBezierPolygon.04.cat-star-toPolygon.png";
    await page.screenshot({path: U.newPath + filename});

    const star = await onlyRegion();
    assert.approximately(star.area/starArea, 1, 1e-6, 'toPolygon should give back the original polygon');
    await assertPolygon(star, 'star back to a polygon');
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
