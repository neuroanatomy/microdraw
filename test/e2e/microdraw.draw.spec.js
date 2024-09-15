/* global Microdraw */

'use strict';
const chai = require('chai');
const puppeteer = require('puppeteer');

const U = require('../mocha.test.util');
const UI = require('../UI');

const {assert} = chai;

// try {
//   require('puppeteer');
// } catch (e) {
//   console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`);
//   process.exit(1);
// }

const shadow = (sel) => `document.querySelector("#microdraw").shadowRoot.querySelector("${sel}")`;

const selectTool = (tool) => `document.querySelector(".tools ${tool}")`;

let browser;
let page;

const clickTool = async function (tool) {
  const handle = await page.evaluateHandle(selectTool(tool));
  await handle.click();
};

const shadowclick = async function (sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

describe('Editing tools: draw polygons and curves', () => {
  it('opens a data page', async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], dumpio: false});
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    await page.goto( // load test page
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );
    await U.waitUntilHTMLRendered(page);
    const filename = 'draw.01.cat.png';
    await page.screenshot({path: U.newPath + filename});
    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'draw.01.cat.png'
    // );
    // assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a triangle', async () => {
    // select the polygon tool
    await clickTool(UI.DRAWPOLYGON);
    // draw a triangle
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);

    const filename = 'draw.02.cat-triangle.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);
  }).timeout(0);

  it('does not keep the unsaved triangle upon reload', async () => {
    await page.goto( // reload
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    const filename = 'draw.03.cat-empty-reload.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);

    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'draw.03.cat-empty-reload.png'
    // );
    // assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws and saves a triangle', async () => {
    // select the polygon tool
    await clickTool(UI.DRAWPOLYGON);
    // draw a triangle
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);

    await clickTool(UI.SAVE); // select the save tool
    await page.goto( // reloads
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    const filename = 'draw.04.cat-triangle-reload.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 1`);
    assert(res.pathSegments === 3, `Path has ${res.pathSegments} segments instead of 3`);

    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'draw.04.cat-triangle-reload.png'
    // );
    // assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('selects, deletes and saves the triangle', async () => {
    await clickTool(UI.SELECT); // select tool
    await shadowclick(UI.CANVAS); // select triangle
    await page.mouse.click(350, 182);
    await clickTool(UI.DELETE); // delete tool
    await clickTool(UI.SAVE); // select the save tool
    await page.goto( // reload
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      { waitUntil: 'networkidle0' }
    );

    const filename = 'draw.05.cat-empty-reload.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 0, `Regions.length is ${res.regionsLength} instead of 0`);

    // const diff = await U.comparePageScreenshots(
    //   page,
    //   'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
    //   'draw.05.cat-empty-reload.png'
    // );
    // assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a curve', async () => {
    // page.on('console', message => console.log(`${message.type().substr(0, 3).toUpperCase()} ${message.text()}`));
    await clickTool(UI.DRAW);

    const o = [U.width*2/3, U.height/2];
    const r = U.width/4;
    for(let a=0; a<=360; a+=5) {
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
    await U.waitUntilHTMLRendered(page);

    const filename = 'draw.06.cat-draw-circle.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 0`);
    // "Draw" simplifies on mouse up, so the original 72 vertices become 11
    assert(res.pathSegments === 11, `Path has ${res.pathSegments} segments instead of 11`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('adds a point', async () => {
    await clickTool(UI.ADDPOINT);

    const o = [U.width*2/3, U.height/2];
    const r = U.width/4;
    const a = 100;
    const x = o[0] + r*Math.cos(a*Math.PI/180);
    const y = o[1] + r*Math.sin(a*Math.PI/180);
    await page.mouse.click(x, y);
    await U.waitUntilHTMLRendered(page);

    const filename = 'draw.07.cat-draw-addPoint.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 0`);
    assert(res.pathSegments === 12, `Path has ${res.pathSegments} segments instead of 12`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct1, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('removes a point', async () => {
    await clickTool(UI.DELETEPOINT);

    const o = [U.width*2/3, U.height/2];
    const r = U.width/4;
    const a = 100;
    const x = o[0] + r*Math.cos(a*Math.PI/180);
    const y = o[1] + r*Math.sin(a*Math.PI/180);
    await page.mouse.click(x, y);
    await U.waitUntilHTMLRendered(page);

    const filename = 'draw.08.cat-draw-deletePoint.png';
    await page.screenshot({path: U.newPath + filename});

    const res = await page.evaluate(() => ({
      regionsExists: typeof (Microdraw.ImageInfo[0].Regions) !== 'undefined',
      regionsLength: Microdraw.ImageInfo[0].Regions.length,
      pathSegments: Microdraw.ImageInfo[0].Regions[0].path.segments.length
    }));
    // console.log(res);
    assert(res.regionsExists === true, 'No Regions object');
    assert(res.regionsLength === 1, `Regions.length is ${res.regionsLength} instead of 0`);
    assert(res.pathSegments === 11, `Path has ${res.pathSegments} segments instead of 11`);

    // const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    // assert(diff<U.pct1, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
