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

describe('Editing tools: undo and redo', () => {
  it('opens a data page', async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], dumpio: false});
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    const diff = await U.comparePageScreenshots(
      page,
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      'undo.01.cat.png'
    );
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('draws a triangle, a square and a circle', async () => {
    // select the polygon tool
    await clickTool(UI.DRAWPOLYGON);

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
    await clickTool(UI.DRAW);
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
    await U.waitUntilHTMLRendered(page);

    const filename = 'undo.02.cat-triangle-square-circle.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('undo', async () => {
    for(let i=0; i<10; i+=1) {
      // eslint-disable-next-line no-await-in-loop
      await clickTool(UI.UNDO);
    }
    await U.waitUntilHTMLRendered(page);

    const filename = 'undo.03.undo.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  it('redo', async () => {
    for(let i=0; i<10; i+=1) {
      // eslint-disable-next-line no-await-in-loop
      await clickTool(UI.REDO);
    }
    await U.waitUntilHTMLRendered(page);

    const filename = 'undo.04.redo.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('can undo an annotation from a different layer', async () => {
    // reload
    await page.reload();
    await U.waitUntilHTMLRendered(page);

    // draw a triangle
    await clickTool(UI.DRAWPOLYGON);
    await page.mouse.click(300, 100);
    await page.mouse.click(400, 100);
    await page.mouse.click(350, 200);
    await page.mouse.click(300, 100);

    // delete it
    await clickTool(UI.DELETE);

    // go to the next image
    await clickTool(UI.NEXT);
    await U.waitUntilHTMLRendered(page);

    // undo
    await clickTool(UI.UNDO);
    await U.waitUntilHTMLRendered(page);

    const filename = 'undo.05.undo-different-page.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);


  after(async () => {
    await browser.close();
  });
});
