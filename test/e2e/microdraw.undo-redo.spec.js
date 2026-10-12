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
  scratch probe (Chrome 116.0.5845.96, 800x600 viewport, cat.json slice 0) and
  reading H.regionState; identical across two probe runs.

  The three shapes take 10 undo steps (4 triangle clicks, 5 square clicks, 1
  freehand stroke), so 10 undos remove everything and 10 redos restore it.
  The freehand circle is simplified on mouse up to 23 curved segments.
  Undo on another slice switches back to the slice the undo step belongs to
  (Microdraw.applyUndo calls setImage), so the last test ends on slice 0.
*/
const HOME_ZOOM = 0.92;
const UNDO_STEPS = 10;
// [segments, curved segments, page bounds [x, y, width, height]], bottom first
const TRIANGLE = { segments: 3, curved: 0, bounds: [300, 100, 100, 100] };
const SQUARE = { segments: 4, curved: 0, bounds: [400, 150, 50, 100] };
const CIRCLE = { segments: 23, curved: 23, bounds: [399.5, 99.3, 199.5, 200.3] };
const BOUNDS_TOLERANCE = 2; // px

// Samples at least 10 px from every outline (the square-only area is too thin to sample safely)
const AT = {
  triangle: [350, 133],
  squareAndCircle: [440, 200],
  circleOnly: [550, 200],
  outside: [200, 400]
};

let drawn;

const assertBounds = (actual, expected, what) => {
  const got = [actual.x, actual.y, actual.width, actual.height];
  got.forEach((v, i) => {
    assert.approximately(v, expected[i], BOUNDS_TOLERANCE, `${what}: bounds [x, y, w, h] are ${got.map(Math.round)}, expected ${expected}`);
  });
};

const assertShape = (region, want, what) => {
  assert.equal(region.segments, want.segments, `${what}: segments`);
  assert.equal(region.curvedSegments, want.curved, `${what}: curved segments`);
  assert.isTrue(region.closed, `${what}: not closed`);
  assertBounds(region.viewBounds, want.bounds, what);
};

// The pixel at `where` shows `regions` (bottom first) with their own fills; [] means transparent.
const assertPixelShows = async (where, regions) => {
  const px = await H.samplePixel(page, 'paper', ...AT[where]);
  const expected = H.expectedFillPixel(regions);
  px.forEach((v, i) => {
    assert.approximately(v, expected[i], 3, `${where}: pixel ${px}, expected ${expected}`);
  });
};

const stacks = () => page.evaluate(() => {
  const M = window.Microdraw;

  return {
    undo: M.UndoStack.length,
    redo: M.RedoStack.length,
    slice: M.imageOrder.indexOf(M.currentImage),
    perSlice: M.imageOrder.map((name) => M.ImageInfo[name].Regions.length)
  };
});

// eslint-disable-next-line max-statements
const assertThreeShapes = async (what) => {
  const regions = await H.regionState(page);
  assert.lengthOf(regions, 3, what);
  const [triangle, square, circle] = regions;
  assertShape(triangle, TRIANGLE, `${what}, triangle`);
  assertShape(square, SQUARE, `${what}, square`);
  assertShape(circle, CIRCLE, `${what}, circle`);
  await assertPixelShows('triangle', [triangle]);
  await assertPixelShows('squareAndCircle', [square, circle]);
  await assertPixelShows('circleOnly', [circle]);
  await assertPixelShows('outside', []);

  return regions;
};

describe('Editing tools: undo and redo', () => {
  // eslint-disable-next-line max-statements
  it('opens a data page', async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await H.settleFrames(page);

    const vp = await H.viewportState(page);
    assert.equal(vp.slice, 0);
    assert.equal(vp.sliceCount, 2);
    assert.isTrue(vp.fullyLoaded, 'image tiles not fully loaded');
    assert.approximately(vp.zoom, HOME_ZOOM, 1e-6);
    assert.lengthOf(await H.regionState(page), 0);

    // the image is drawn (loose: opaque, not blank white); no annotation over it
    const img = await H.samplePixel(page, 'osd', ...AT.triangle);
    assert.equal(img[3], 255, `image pixel ${img} is not opaque`);
    assert.isBelow(img[0] + img[1] + img[2], 3*250, `image pixel ${img} is blank`);
    await assertPixelShows('triangle', []);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('draws a triangle, a square and a circle', async () => {
    // select the polygon tool
    await shadowclick(UI.DRAWPOLYGON);

    // draw a triangle
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);

    // draw a square
    await page.mouse.click(400, 150);
    await page.mouse.click(450, 150);
    await page.mouse.click(450, 250);
    await page.mouse.click(400, 250);
    await page.mouse.click(400, 150);

    // draw a circle
    await shadowclick(UI.DRAW);
    const o = [500, 200];
    const r = 100;
    for(let a=0; a<=360; a+=1) {
      const x = o[0] + r*Math.cos(a*Math.PI/180);
      const y = o[1] + r*Math.sin(a*Math.PI/180);
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(x, y);
      if( a === 0 ) {
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.down();
      }
    }
    await page.mouse.up();
    await H.settleFrames(page);

    drawn = await assertThreeShapes('drawn');
    assert.deepEqual(await stacks(), { undo: UNDO_STEPS, redo: 0, slice: 0, perSlice: [3, 0] });
  }).timeout(U.mediumTimeout);

  it('undo', async () => {
    for(let i=0; i<10; i+=1) {
      // eslint-disable-next-line no-await-in-loop
      await shadowclick(UI.UNDO);
    }
    await H.waitForTools(page);
    await H.settleFrames(page);

    assert.lengthOf(await H.regionState(page), 0, 'regions left after undoing everything');
    assert.deepEqual(await stacks(), { undo: 0, redo: UNDO_STEPS, slice: 0, perSlice: [0, 0] });
    for (const where of Object.keys(AT)) {
      // eslint-disable-next-line no-await-in-loop
      await assertPixelShows(where, []);
    }
  }).timeout(U.shortTimeout);

  it('redo', async () => {
    for(let i=0; i<10; i+=1) {
      // eslint-disable-next-line no-await-in-loop
      await shadowclick(UI.REDO);
    }
    await H.settleFrames(page);

    const regions = await assertThreeShapes('after redo');
    assert.deepEqual(await stacks(), { undo: UNDO_STEPS, redo: 0, slice: 0, perSlice: [3, 0] });
    regions.forEach((reg, i) => {
      const d = drawn[i].viewBounds;
      // the same place, up to the rounding of the undo stack's JSON round trip
      assertBounds(reg.viewBounds, [d.x, d.y, d.width, d.height], `region ${i} after redo, against where it was drawn`);
      assert.equal(reg.index, drawn[i].index, `region ${i} changed z-order`);
    });
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('can undo an annotation from a different layer', async () => {
    // reload
    await page.reload();
    await H.waitForMicrodraw(page, 0);

    // draw a triangle
    await shadowclick(UI.DRAWPOLYGON);
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);

    // delete it
    await shadowclick(UI.DELETE);

    // go to the next image
    await shadowclick(UI.NEXT);
    await H.waitForMicrodraw(page, 1);

    // undo: goes back to slice 0, where the deletion happened
    await shadowclick(UI.UNDO);
    await H.waitForMicrodraw(page, 0);
    await H.settleFrames(page);

    const st = await stacks();
    assert.equal(st.slice, 0, 'undo did not go back to slice 0');
    assert.deepEqual(st.perSlice, [1, 0], 'the deleted triangle is not back on slice 0');
    assert.equal(st.redo, 1);
    const [triangle] = await H.regionState(page);
    assertShape(triangle, TRIANGLE, 'restored triangle');
    await assertPixelShows('triangle', [triangle]);
    await assertPixelShows('circleOnly', []);
  }).timeout(U.shortTimeout);

  after(async () => {
    await context.close();
  });
});
