/* eslint-disable max-lines */
/* eslint-disable max-statements */
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
let page1, page2;
let res;

// eslint-disable-next-line max-statements
describe('Editing tools: multiple users drawing on the same dataset', () => {
  before(async () => {
    browser = await launchBrowser();
  });

  describe('simultaneously opening the same data set', () => {
    it('opens data page on browser 1', async () => {
      page1 = await browser.newPage();
      await page1.setViewport({width: U.width, height: U.height});
      await H.openData(page1, U.url('/data?source=/test_data/cat.json&slice=0'));
      await H.settleFrames(page1);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);
    });

    // eslint-disable-next-line max-statements
    it('open data page on browser 2', async () => {
      page2 = await browser.newPage();
      await page2.setViewport({width: U.width, height: U.height});
      await H.openData(page2, U.url('/data?source=/test_data/cat.json&slice=0'));
      await shadowclick(UI.NEXT, page2);
      await H.waitForMicrodraw(page2, 1);
      await H.settleFrames(page2);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[1].Regions.length
      }));

      assert(res.sliceIndex === 1, 'Slice index is not 1');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);
    });
  });

  describe('simultaneously drawing on different slices', () => {
    it('draws triangle in slice 1, browser 1, and save', async () => {
      await page1.bringToFront();
      await shadowclick(UI.DRAWPOLYGON, page1);
      await page1.mouse.click(300, 100);
      await page1.mouse.click(400, 100);
      await page1.mouse.click(350, 200);
      await page1.mouse.click(300, 100);
      await H.waitForSave(page1, () => shadowclick(UI.SAVE, page1));
      await H.settleFrames(page1);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
      }));
      // console.log(res);

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);
    });

    // eslint-disable-next-line max-statements
    it('draw square in slice 2, browser 2, and save', async () => {
      await page2.bringToFront();
      await shadowclick(UI.DRAWPOLYGON, page2);
      await page2.mouse.click(400, 100);
      await page2.mouse.click(500, 100);
      await page2.mouse.click(500, 200);
      await page2.mouse.click(400, 200);
      await page2.mouse.click(400, 100);
      await H.waitForSave(page2, () => shadowclick(UI.SAVE, page2));
      await H.settleFrames(page2);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[1].Regions.length,
        pathSegments: Microdraw.ImageInfo[1].Regions[0].path.segments.length
      }));

      assert(res.sliceIndex === 1, 'Slice index is not 1');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);
    });

    it('show triangle in slice 1 when browser 2 moves to slice 1', async () => {
      await shadowclick(UI.PREVIOUS, page2);
      await H.waitForMicrodraw(page2, 0);
      await H.settleFrames(page2);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
      }));
      // console.log(res);

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);
    });

    it('show square in slice 2 when browser 1 moves to slice 2', async () => {
      await page1.bringToFront();
      await shadowclick(UI.NEXT, page1);
      await H.waitForMicrodraw(page1, 1);
      await H.settleFrames(page1);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[1].Regions.length,
        pathSegments: Microdraw.ImageInfo[1].Regions[0].path.segments.length
      }));
      // console.log(res);

      assert(res.sliceIndex === 1, 'Slice index is not 1');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);
    });
  });

  describe('simultaneously deleting', () => {
    // eslint-disable-next-line max-statements
    it('delete triangle in browser 1, disappears from both browsers', async () => {
      await shadowclick(UI.PREVIOUS, page1);
      await H.waitForMicrodraw(page1, 0);
      await shadowclick(UI.SELECT, page1);
      await page1.mouse.click(350, 150);
      await shadowclick(UI.DELETE, page1);
      await H.waitForSave(page1, () => shadowclick(UI.SAVE, page1));
      await page1.reload();
      await H.waitForMicrodraw(page1, 0);

      await page2.bringToFront();
      await page2.reload();
      await H.waitForMicrodraw(page2, 0);
      await H.settleFrames(page1);
      await H.settleFrames(page2);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);
    });

    // eslint-disable-next-line max-statements
    it('delete square in browser 2, disappears from both browsers', async () => {
      await shadowclick(UI.NEXT, page2);
      await H.waitForMicrodraw(page2, 1);
      await shadowclick(UI.SELECT, page2);
      await page2.mouse.click(450, 150);
      await shadowclick(UI.DELETE, page2);
      await H.waitForSave(page2, () => shadowclick(UI.SAVE, page2));
      await page2.reload();
      await H.waitForMicrodraw(page2, 1);

      await page1.bringToFront();
      await shadowclick(UI.NEXT, page1);
      await H.waitForMicrodraw(page1, 1);
      await H.settleFrames(page1);
      await H.settleFrames(page2);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[1].Regions.length
      }));

      assert(res.sliceIndex === 1, 'Slice index is not 1');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[1].Regions.length
      }));

      assert(res.sliceIndex === 1, 'Slice index is not 1');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);
    });
  });

  describe('simultaneously drawing on the same slices', () => {
    before(async() => {
      // open slice 1 in both browsers
      await page1.goto(
        U.url('/data?source=/test_data/cat.json&slice=0'),
        { waitUntil: 'networkidle0' }
      );
      await page2.goto(
        U.url('/data?source=/test_data/cat.json&slice=0'),
        { waitUntil: 'networkidle0' }
      );
    });

    // eslint-disable-next-line max-statements
    it('draw triangle in slice 1, browser 1, and save', async () => {
      await page1.bringToFront();
      await shadowclick(UI.DRAWPOLYGON, page1);
      await page1.mouse.click(300, 100);
      await page1.mouse.click(400, 100);
      await page1.mouse.click(350, 200);
      await page1.mouse.click(300, 100);
      await H.waitForSave(page1, () => shadowclick(UI.SAVE, page1));
      await H.settleFrames(page1);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);
    });

    // eslint-disable-next-line max-statements
    it('draw square in slice 1, browser 2, and save', async () => {
      await page2.bringToFront();
      await shadowclick(UI.DRAWPOLYGON, page2);
      await page2.mouse.click(400, 100);
      await page2.mouse.click(500, 100);
      await page2.mouse.click(500, 200);
      await page2.mouse.click(400, 200);
      await page2.mouse.click(400, 100);
      await H.waitForSave(page2, () => shadowclick(UI.SAVE, page2));
      await H.settleFrames(page2);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
      assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);
    });

    it('show triangle and square after reloading in browser 1', async () => {
      await page1.bringToFront();
      await page1.reload();
      await H.waitForMicrodraw(page1, 0);
      await H.settleFrames(page1);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions.reduce((x, y) => x + y.path.segments.length, 0)
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 2, `Regions.length is ${res.regionsLength} instead of 2`);
      assert(res.pathSegments === 7, `Path has ${res.pathSegments} segments instead of 7`);
    });

    it('show triangle and square after reloading in browser 2', async () => {
      await page2.bringToFront();
      await page2.reload();
      await H.waitForMicrodraw(page2, 0);
      await H.settleFrames(page2);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length,
        pathSegments: Microdraw.ImageInfo[0].Regions.reduce((x, y) => x + y.path.segments.length, 0)
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 2, `Regions.length is ${res.regionsLength} instead of 2`);
      assert(res.pathSegments === 7, `Path has ${res.pathSegments} segments instead of 7`);
    });

    // eslint-disable-next-line max-statements
    it('delete triangle and square in browser 1, disappears from both browsers', async () => {
      await page1.bringToFront();
      await shadowclick(UI.SELECT, page1);
      await page1.mouse.click(350, 150);
      await shadowclick(UI.DELETE, page1);
      await page1.waitForFunction(() => Microdraw.ImageInfo[0].Regions.length === 1, {timeout: U.shortTimeout});
      await H.waitForTools(page1);
      await page1.mouse.click(450, 150);
      await shadowclick(UI.DELETE, page1);
      await H.waitForSave(page1, () => shadowclick(UI.SAVE, page1));
      await page1.reload();
      await H.waitForMicrodraw(page1, 0);

      await page2.bringToFront();
      await page2.reload();
      await H.waitForMicrodraw(page2, 0);
      await H.settleFrames(page2);

      res = await page1.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);

      res = await page2.evaluate(() => ({
        sliceIndex: Number(Microdraw.dom.querySelector("#slice").dataset.val),
        regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
        regionsLength: Microdraw.ImageInfo[0].Regions.length
      }));

      assert(res.sliceIndex === 0, 'Slice index is not 0');
      assert(res.regionsExists === true, 'No Regions object');
      assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);
    });
  });

  after(async () => {
    await browser.close();
  });
});
