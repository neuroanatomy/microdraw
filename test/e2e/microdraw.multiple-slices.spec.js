/* global Microdraw */

'use strict';
const chai = require('chai');
const puppeteer = require('puppeteer');

const U = require('../mocha.test.util');
const UI = require('../UI');

const {assert} = chai;


const selectTool = (tool) => `document.querySelector(".tools ${tool}")`;

let browser;
let page;

const clickTool = async function (tool, testPage) {
  const handle = await testPage.evaluateHandle(selectTool(tool));
  await handle.click();
};

describe('Editing tools: draw in multiple slices', () => {
  before(async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });
  it('opens data page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    // page.on('console', (message) =>
    //   console.log(`${message.type().substr(0, 3)
    //     .toUpperCase()} ${message.text()}`));

    await page.goto(
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    const filename = 'multiple-slices.01.slice1.png';
    await page.screenshot({path: U.newPath + filename});
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draw and save a square in 1st slice', async () => {
    await clickTool(UI.DRAWPOLYGON, page);
    await page.mouse.click(400, 100);
    await page.mouse.click(500, 100);
    await page.mouse.click(500, 200);
    await page.mouse.click(400, 200);
    await page.mouse.click(400, 100);
    await clickTool(UI.SAVE, page);
    await U.delay(1000);

    const filename = 'multiple-slices.02.slice1-square.png';
    await page.screenshot({path: U.newPath + filename});
    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different`);

    const res = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);

    assert(res.sliceIndex === 0, 'Slice index is not 0');
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);

  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('move to the 2nd slice and draw and save a triangle', async () => {
    await U.waitUntilHTMLRendered(page);
    await clickTool(UI.NEXT, page);
    await U.waitUntilHTMLRendered(page);

    let filename = 'multiple-slices.03.slice2.png';
    await page.screenshot({path: U.newPath + filename});

    await clickTool(UI.DRAWPOLYGON, page);
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);
    await clickTool(UI.SAVE, page);
    await U.delay(1000);

    filename = 'multiple-slices.04.slice2-triangle.png';
    await page.screenshot({path: U.newPath + filename});
    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different`);

    const res = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[1].Regions.length,
      pathSegments: Microdraw.ImageInfo[1].Regions[0].path.segments.length
    }));

    assert(res.sliceIndex === 1, 'Slice index is not 1');
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);

  }).timeout(0);

  it('square is still present after reloading the 1st slice', async () => {
    await page.goto(
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    const filename = 'multiple-slices.05.slice1-reload.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));

    // console.log(res);
    assert(res.sliceIndex === 0, 'Slice index is not 0');
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 4, `Path has ${res.pathSegments} segments instead of 4`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('triangle is still present after reloading 2nd slice', async () => {
    await page.reload();
    await U.waitUntilHTMLRendered(page);
    await clickTool(UI.NEXT, page);
    await U.waitUntilHTMLRendered(page);

    const res = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[1].Regions.length,
      pathSegments: Microdraw.ImageInfo[1].Regions[0].path.segments.length
    }));

    const filename = 'multiple-slices.06.slice2-reload.png';
    await page.screenshot({path: U.newPath + filename});

    // console.log(res);
    assert(res.sliceIndex === 1, 'Slice index is not 1');
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('clean up the 2 slices', async () => {
    await page.goto(
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    // cleanup 1st slice
    await U.waitUntilHTMLRendered(page);
    await clickTool(UI.SELECT, page);
    await page.mouse.click(450, 150);
    await clickTool(UI.DELETE, page);
    await clickTool(UI.SAVE, page);
    await U.delay(1000);

    // cleanup 2nd slice
    await clickTool(UI.NEXT, page);
    await U.waitUntilHTMLRendered(page);
    await clickTool(UI.SELECT, page);
    await page.mouse.click(350, 150);
    await clickTool(UI.DELETE, page);
    await clickTool(UI.SAVE, page);
    await U.delay(1000);
    await page.reload();
    await U.waitUntilHTMLRendered(page);

    // check 1st slice is clean
    await clickTool(UI.PREVIOUS, page);
    await U.waitUntilHTMLRendered(page);

    let filename = 'multiple-slices.07.slice1-cleanup.png';
    await page.screenshot({path: U.newPath + filename});

    const res1 = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length
    }));
    // console.log(res1);
    assert(res1.sliceIndex === 0, 'Slice index is not 0');
    assert(res1.regionsExists === true, 'No Regions object in slice 1');
    assert(res1.regionsLength === 0, `Regions.length is ${res1.regionsLength} instead of 0 in slice 1`);

    // check 2nd slice is clean
    await clickTool(UI.NEXT, page);
    await U.waitUntilHTMLRendered(page);
    const res2 = await page.evaluate(() => ({
      sliceIndex: Number(document.querySelector('.tools input[type=range]').value),
      regionsExists: typeof (Microdraw.ImageInfo[1].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[1].Regions.length
    }));
    // console.log(res2);

    filename = 'multiple-slices.08.slice2-cleanup.png';
    await page.screenshot({path: U.newPath + filename});

    assert(res2.sliceIndex === 1, 'Slice index is not 1');
    assert(res2.regionsExists === true, 'No Regions object in slice 2');
    assert(res2.regionsLength === 0, `Regions.length is ${res2.regionsLength} instead of 0 in slice 2`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
