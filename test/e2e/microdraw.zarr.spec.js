/* global Microdraw */

'use strict';
const UI = require('../UI');
const U = require('../mocha.test.util');
const chai = require('chai');
const {assert} = chai;

const { launchBrowser } = require('./browser');
const H = require('./helpers');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

const shadowclick = async function (sel, testPage) {
  const handle = await testPage.evaluateHandle(shadow(sel));
  await handle.click();
};

let browser;
let page;

describe('OME-Zarr tile source', () => {
  before(async () => {
    browser = await launchBrowser();
  });

  // eslint-disable-next-line max-statements
  it('opens the zarr source with correct dimensions, no webgl taint, and the webgl drawer', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await H.openData(page, U.url('/data?source=/test_data/cat-zarr.json&slice=0'));
    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      width: Microdraw.viewer.source.width,
      height: Microdraw.viewer.source.height,
      issues: Microdraw.viewer.world.getItemAt(0)._issues,
      drawerType: Microdraw.viewer.drawer.getType(),
      imageOrderLength: Microdraw.imageOrder.length
    }));

    assert(res.width === 480, `viewer.source.width is ${res.width} instead of 480`);
    assert(res.height === 360, `viewer.source.height is ${res.height} instead of 360`);
    assert(
      Object.keys(res.issues).length === 0,
      `viewer.world.getItemAt(0)._issues is not empty: ${JSON.stringify(res.issues)}`
    );
    assert(res.drawerType === 'webgl', `viewer.drawer.getType() is ${res.drawerType} instead of "webgl"`);
    assert(res.imageOrderLength === 3, `imageOrder.length is ${res.imageOrderLength} instead of 3`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws and saves a region on the zarr source', async () => {
    await shadowclick(UI.DRAWPOLYGON, page);
    await page.mouse.click(400, 100);
    await page.mouse.click(500, 100);
    await page.mouse.click(500, 200);
    await page.mouse.click(400, 200);
    await page.mouse.click(400, 100);
    await H.waitForSave(page, () => shadowclick(UI.SAVE, page));
    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));

    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);
  }).timeout(0);

  it('the region round-trips through a reload', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat-zarr.json&slice=0'));
    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));

    assert(res.regionsExists === true, 'No Regions object after reload');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1 after reload`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4 after reload`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('the slice slider moves across z planes without a webgl taint', async () => {
    await shadowclick(UI.NEXT, page);
    await H.waitForMicrodraw(page, 1);
    await H.settleFrames(page);

    let res = await page.evaluate(() => ({
      sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
      issues: Microdraw.viewer.world.getItemAt(0)._issues
    }));
    assert(res.sliceIndex === 1, `Slice index is ${res.sliceIndex} instead of 1`);
    assert(Object.keys(res.issues).length === 0, `z=1 has webgl issues: ${JSON.stringify(res.issues)}`);

    await shadowclick(UI.NEXT, page);
    await H.waitForMicrodraw(page, 2);
    await H.settleFrames(page);

    res = await page.evaluate(() => ({
      sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
      issues: Microdraw.viewer.world.getItemAt(0)._issues
    }));
    assert(res.sliceIndex === 2, `Slice index is ${res.sliceIndex} instead of 2`);
    assert(Object.keys(res.issues).length === 0, `z=2 has webgl issues: ${JSON.stringify(res.issues)}`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('clean up the region', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat-zarr.json&slice=0'));

    await shadowclick(UI.SELECT, page);
    await page.mouse.click(450, 150);
    await shadowclick(UI.DELETE, page);
    await H.waitForSave(page, () => shadowclick(UI.SAVE, page));
    await page.reload();
    await H.waitForMicrodraw(page, 0);
    await H.settleFrames(page);

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length
    }));
    assert(res.regionsExists === true, 'No Regions object after cleanup');
    assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0 after cleanup`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
