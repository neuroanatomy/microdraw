'use strict';
const chai = require('chai');
const puppeteer = require('puppeteer');

const U = require('../../test/mocha.test.util');
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

describe('View pages and data', () => {
  before(async () => {
    browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });

  it('shows the landing page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    const diff = await U.comparePageScreenshots(
      page,
      'http://localhost:3000',
      'view.01.home.png'
    );
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('shows test data, first page', async () => {
    const diff = await U.comparePageScreenshots(
      page,
      'http://localhost:3000/data?source=/test_data/cat.json&slice=0',
      'view.02.cat.png'
    );
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can go to the next page', async () => {
    await clickTool(UI.NEXT);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = 'view.03.cat-next.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can go back to the previous page', async () => {
    await clickTool(UI.PREVIOUS);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = 'view.04.cat-prev.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can zoom in', async () => {
    await clickTool(UI.ZOOMIN);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = 'view.05.cat-zoom-in.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('can translate', async () => {
    await clickTool(UI.NAVIGATE);

    await page.mouse.move(U.width/2, U.height/2);
    await page.mouse.down();
    await page.mouse.move(U.width*2/3, U.height/2, {steps:50});
    await page.mouse.up();
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = 'view.06.cat-zoom-in-translate.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  it('can zoom out', async () => {
    await clickTool(UI.ZOOMOUT);
    await U.waitUntilHTMLRendered(page);
    const filename = 'view.07.cat-zoom-out.png';
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
