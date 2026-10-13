/* global Microdraw */

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
const H = require('./helpers');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

let context;
let page;

const shadowclick = async function (sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

describe('Editing tools: Add regions', () => {
  before(async () => {
    context = await H.newContext();
  });
  it('opens a data page', async () => {
    page = await context.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await H.settleFrames(page);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('draws a square', async () => {
    // select the polygon tool
    await shadowclick(UI.DRAWPOLYGON);
    // draw a square A
    await page.mouse.click(400, 400);
    await page.mouse.click(500, 400);
    await page.mouse.click(500, 500);
    await page.mouse.click(400, 500);
    await page.mouse.click(400, 400);

    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);

  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('draws another square', async () => {
    // draw a square B
    await page.mouse.click(450, 450);
    await page.mouse.click(550, 450);
    await page.mouse.click(550, 550);
    await page.mouse.click(450, 550);
    await page.mouse.click(450, 450);

    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      path1Segments: Microdraw.ImageInfo[0].Regions[0].path.segments.length,
      path2Segments: Microdraw.ImageInfo[0].Regions[1].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 2, `Regions.length is ${res.regionsLength} instead of 2`);
    assert(res.path1Segments === 4, `1st path has ${res.path1Segments} segments instead of 4`);
    assert(res.path2Segments === 4, `2nd path ${res.path2Segments} segments instead of 4`);

  }).timeout(U.shortTimeout);

  it('does the union of the 2 squares', async () => {
    // select union tool
    await shadowclick(UI.ADDREGION);

    // click on square A (square B is already selected)
    await page.mouse.click(405, 405);

    // click on square B (square A is already selected)
    await page.mouse.click(540, 540);

    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 8, `Path has ${res.pathSegments} segments instead of 4`);

  }).timeout(U.shortTimeout);

  after(async () => {
    await H.closeContext(context);
  });
});
