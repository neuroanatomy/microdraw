/* global Microdraw */

'use strict';
const chai = require('chai');
const puppeteer = require('puppeteer');

const U = require('../mocha.test.util');
const UI = require('../UI');

const {assert} = chai;

// try {
//     require('puppeteer')
// } catch (e) {
//     console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`)
//     process.exit(1)
// }

const selectTool = (tool) => `document.querySelector(".tools ${tool}")`;

let browser;
let page;

const clickTool = async function (tool) {
  const handle = await page.evaluateHandle(selectTool(tool));
  await handle.click();
};

describe('Editing tools: Translate, rotate, flip', () => {
  before(async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });
  it('opens a data page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await page.goto('http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' });
    await U.waitUntilHTMLRendered(page);

    const filename = 'transform.01.cat.png';
    await page.screenshot({path: U.newPath + filename});
    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'transform.01.cat.png'
    // );
    // assert(diff<1000, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a square', async () => {
    // select the polygon tool
    await clickTool(UI.DRAWPOLYGON);
    // draw a square
    await page.mouse.click(400, 400);
    await page.mouse.click(500, 400);
    await page.mouse.click(500, 500);
    await page.mouse.click(400, 500);
    await page.mouse.click(400, 400);

    await U.waitUntilHTMLRendered(page);
    const filename = 'transform.02.cat-square.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions?.length,
      pathSegments: Microdraw.ImageInfo[0].Regions?.[0]?.path?.segments?.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('translate', async () => {
    await clickTool(UI.MOVE);
    await page.mouse.click(450, 450);

    const res1 = await page.evaluate(() => ({
      regionX: Microdraw.ImageInfo[0].Regions[0].path.segments[0].point.x
    }));
    console.log(res1);

    await page.mouse.move(450, 450);
    await page.mouse.down();
    await page.mouse.move(300, 300, {steps: 10});
    await page.mouse.up();

    await U.waitUntilHTMLRendered(page);
    const filename = 'transform.03.cat-translate.png';
    await page.screenshot({path: U.newPath + filename});

    const res2 = await page.evaluate(() => ({
      regionX: Microdraw.ImageInfo[0].Regions[0].path.segments[0].point.x
    }));
    console.log(res2);

    assert(res2.regionX < res1.regionX, 'X-coord is not smaller after translation');

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('rotate', async () => {
    await clickTool(UI.SELECT);
    await page.mouse.click(300, 300);

    await clickTool(UI.ROTATE);

    await page.mouse.move(300, 255);
    await page.mouse.down();
    await page.mouse.move(450, 255, {steps: 10});
    await page.mouse.up();

    await U.waitUntilHTMLRendered(page);
    const filename = 'transform.04.cat-rotate.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionTransformationExists: typeof (Microdraw.ImageInfo[0].Regions[0].origin) !== 'undefined'
    }));

    assert(res.regionTransformationExists === true, 'No transformation matrix exists');

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  it('flip', async () => {

    const res1 = await page.evaluate(() => ({
      regionX: Microdraw.ImageInfo[0].Regions[0].path.segments[0].point.x
    }));
    // console.log(res1);

    await clickTool(UI.FLIPREGION);

    const filename = 'transform.05.cat-flip.png';
    await page.screenshot({path: U.newPath + filename});

    const res2 = await page.evaluate(() => ({
      regionX: Microdraw.ImageInfo[0].Regions[0].path.segments[0].point.x
    }));
    // console.log(res2);

    assert(res2.regionX < res1.regionX, 'X-coord of region is not smaller after flip');

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
