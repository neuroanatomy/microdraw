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

describe('Editing tools: subtract regions', () => {
  before(async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });
  it('opens a data page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await page.goto('http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' });
    await U.waitUntilHTMLRendered(page);

    const filename = 'subtractRegion.01.cat.png';
    await page.screenshot({path: U.newPath + filename});
    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'subtractRegion.01.cat.png'
    // );
    // assert(diff<1000, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a square', async () => {
    // select the polygon tool
    await clickTool(UI.DRAWPOLYGON);
    // draw a square C
    await page.mouse.click(400, 400);
    await page.mouse.click(500, 400);
    await page.mouse.click(500, 500);
    await page.mouse.click(400, 500);
    await page.mouse.click(400, 400);

    await U.waitUntilHTMLRendered(page);
    const filename = 'subtractRegion.02.cat-square-C.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws another square', async () => {
    // draw a square D
    await page.mouse.click(450, 450);
    await page.mouse.click(550, 450);
    await page.mouse.click(550, 550);
    await page.mouse.click(450, 550);
    await page.mouse.click(450, 450);

    await U.waitUntilHTMLRendered(page);
    const filename = 'subtractRegion.03.cat-square-D.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[1].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 2, `Regions.length is ${res.regionsLength} instead of 2`);
    assert(res.pathSegments === 4, `New path has ${res.pathSegments} segments instead of 4`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  it('subtract 2nd square from 1st square', async () => {
    await clickTool(UI.SUBTRACTREGION);

    // click on square C (square D is already selected)
    await page.mouse.click(405, 405);

    await U.waitUntilHTMLRendered(page);
    const filename = 'subtractRegion.04.cat-subtraction.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 6, `Resulting path has ${res.pathSegments} segments instead of 6`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
