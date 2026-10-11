'use strict';
const UI = require('../UI');
const U = require('../mocha.test.util');
const chai = require('chai');
var {assert} = chai;

// try {
//   require('puppeteer');
// } catch (e) {
//   console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`);
//   process.exit(1);
// }
const { launchBrowser } = require('./browser');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

let browser;
let page;

const shadowclick = async function(sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

/*
  Expected values, recorded on 2026-10-11 by running these exact steps in a
  scratch probe (Chrome 116.0.5845.96, 800x600 viewport, cat.json slice 0) and
  reading U.regionState / U.viewportState; identical across two probe runs.

  Drawing the star: the first two clicks (0 and 1 degree, about 3.5 px apart)
  close a one-point polygon, so the star itself is a second region, still open
  (and so unfilled) after the last click, with 359 segments. Simplify closes
  and smooths it.
*/
const HOME_ZOOM = 0.92;
const STAR_SEGMENTS = 359;
const SIMPLIFY_ONCE_SEGMENTS = 57;
const SIMPLIFY_TWICE_SEGMENTS = 53;
// Star bounds on the page, in px: [x, y, width, height]
const STAR_VIEW_BOUNDS = [333, 109, 400, 381];
const SIMPLIFY_ONCE_VIEW_BOUNDS = [332.5, 108.5, 387.4, 382.1];
const SIMPLIFY_TWICE_VIEW_BOUNDS = [333, 108.2, 385, 382.7];
const BOUNDS_TOLERANCE = 3; // px

// The star: centre o, radius r, ten points.
const o = [U.width*2/3, U.height/2];
const r = U.width/4;
const at = (deg, rad) => [o[0] + rad*Math.cos(deg*Math.PI/180), o[1] + rad*Math.sin(deg*Math.PI/180)];
const INSIDE = { centre: o, point: at(36, 0.85*r) }; // the centre, and inside the point at 36 degrees
const OUTSIDE = { gap: at(18, 0.7*r), farLeft: [100, U.height/2] }; // between two points, and away from the star

const assertBounds = (actual, expected, what) => {
  const got = [actual.x, actual.y, actual.width, actual.height];
  got.forEach((v, i) => {
    assert.approximately(v, expected[i], BOUNDS_TOLERANCE, `${what}: bounds [x, y, w, h] are ${got.map(Math.round)}, expected ${expected}`);
  });
};

// A pixel of the annotation canvas shows the region's own fill: its colour at its alpha.
const assertShowsFill = (px, region, where) => {
  const hex = region.fill.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
  const alpha = Math.round(255*region.fillAlpha);
  assert.approximately(px[3], alpha, 2, `${where}: alpha is ${px[3]}, expected ${alpha} (pixel ${px})`);
  if (alpha > 0) {
    rgb.forEach((c, i) => assert.approximately(px[i], c, 3, `${where}: pixel ${px} is not the fill ${region.fill}`));
  }
};

const assertTransparent = (px, where) => {
  assert.equal(px[3], 0, `${where}: pixel ${px} is not transparent`);
};

const checkPixels = async (star) => {
  for (const [name, [x, y]] of Object.entries(INSIDE)) {
    // eslint-disable-next-line no-await-in-loop
    assertShowsFill(await U.samplePixel(page, 'paper', x, y), star, `inside the star (${name})`);
  }
  for (const [name, [x, y]] of Object.entries(OUTSIDE)) {
    // eslint-disable-next-line no-await-in-loop
    assertTransparent(await U.samplePixel(page, 'paper', x, y), `outside the star (${name})`);
  }
};

describe('Editing tools: simplify', () => {
  before(async () => {
    browser = await launchBrowser();
  });
  // eslint-disable-next-line max-statements
  it('opens a data page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await U.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await U.settleFrames(page);
    await page.screenshot({path: U.newPath + 'simplify.01.cat.png'});

    const vp = await U.viewportState(page);
    assert.equal(vp.slice, 0);
    assert.equal(vp.sliceCount, 2);
    assert.equal(vp.imageWidth, 480);
    assert.equal(vp.imageHeight, 360);
    assert.isTrue(vp.fullyLoaded, 'image tiles not fully loaded');
    assert.approximately(vp.zoom, HOME_ZOOM, 1e-6);
    assert.lengthOf(await U.regionState(page), 0);

    // the image is drawn (loose: opaque, not blank white); no annotation over it
    const img = await U.samplePixel(page, 'osd', ...o);
    assert.equal(img[3], 255, `image pixel ${img} is not opaque`);
    assert.isBelow(img[0] + img[1] + img[2], 3*250, `image pixel ${img} is blank`);
    assertTransparent(await U.samplePixel(page, 'paper', ...o), 'annotation canvas');
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a star polygon', async () => {
    // select the polygon tool
    await shadowclick(UI.DRAWPOLYGON);

    for(let a=0; a<=360; a += 1) {
      const r1 = r*(0.8+ 0.2*Math.cos(a*Math.PI/180*10));
      const x = o[0] + r1*Math.cos(a*Math.PI/180);
      const y = o[1] + r1*Math.sin(a*Math.PI/180);
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(x, y);
    }
    await U.settleFrames(page);

    const filename = "simplify.02.cat-star.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 2);
    assert.equal(regions[0].segments, 1, 'the first region should be the one-point polygon');
    const [, star] = regions;
    assert.equal(star.segments, STAR_SEGMENTS);
    assert.equal(star.curvedSegments, 0, 'a polygon has no curves');
    assert.isFalse(star.closed);
    assert.isTrue(star.isCurrent && star.selected, 'the star is not the selected region');
    assertBounds(star.viewBounds, STAR_VIEW_BOUNDS, 'star');
    // not closed yet, so not filled
    assert.equal(star.fillAlpha, 0);
    await checkPixels(star);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('simplify once', async () => {
    await shadowclick(UI.SIMPLIFY);
    await U.waitForTools(page);
    await U.settleFrames(page);

    const filename = "simplify.03.cat-simplified.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 2);
    const [, star] = regions;
    assert.equal(star.segments, SIMPLIFY_ONCE_SEGMENTS);
    assert.equal(star.curvedSegments, star.segments, 'every segment of the simplified path is a curve');
    assert.isTrue(star.closed);
    assert.isTrue(star.isCurrent, 'the star is not the selected region');
    assertBounds(star.viewBounds, SIMPLIFY_ONCE_VIEW_BOUNDS, 'simplified star');
    assert.equal(star.fillAlpha, 0.5);
    await checkPixels(star);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('simplify again', async () => {
    await shadowclick(UI.SIMPLIFY);
    await U.settleFrames(page);

    const filename = "simplify.04.cat-simplified.png";
    await page.screenshot({path: U.newPath + filename});

    const regions = await U.regionState(page);
    assert.lengthOf(regions, 2);
    const [, star] = regions;
    assert.equal(star.segments, SIMPLIFY_TWICE_SEGMENTS);
    assert.isBelow(star.segments, SIMPLIFY_ONCE_SEGMENTS);
    assert.equal(star.curvedSegments, star.segments, 'every segment of the simplified path is a curve');
    assert.isTrue(star.closed);
    assertBounds(star.viewBounds, SIMPLIFY_TWICE_VIEW_BOUNDS, 'star simplified twice');
    assert.equal(star.fillAlpha, 0.5);
    await checkPixels(star);
  }).timeout(0);


  after(async () => {
    await browser.close();
  });
});
