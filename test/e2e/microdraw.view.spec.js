'use strict';
const UI = require('../UI');
const U = require('../../test/mocha.test.util');
const chai = require('chai');
var {assert} = chai;

// try {
//     require('puppeteer')
// } catch (e) {
//     console.warn(`[microdraw]: dependency error: puppeteer needs to be installed manually. - npm i puppeteer`)
//     process.exit(1)
// }
const { launchBrowser } = require('./browser');

const shadow = (sel) => `document.querySelector("#content").shadowRoot.querySelector("${sel}")`;

let browser;
let page;

const shadowclick = async function(sel) {
  const handle = await page.evaluateHandle(shadow(sel));
  await handle.click();
};

describe('View pages and data', () => {
  before(async () => {
    browser = await launchBrowser();
  });

  it('shows the landing page', async () => {
    page = await browser.newPage();
    await page.setViewport({width: U.width, height: U.height});
    const diff = await U.comparePageScreenshots(
      page,
      U.url(''),
      'view.01.home.png',
      // The landing page has a looping background video whose current frame
      // at capture time is non-deterministic across machines. Freeze it on
      // the static poster image underneath so the screenshot is stable.
      (testPage) => testPage.evaluate(() => {
        const video = document.getElementById('neurons');
        if (video) {
          video.pause();
          video.style.display = 'none';
        }
      })
    );
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('shows test data, first page', async () => {
    const diff = await U.comparePageScreenshots(
      page,
      U.url('/data?source=/test_data/cat.json&slice=0'),
      'view.02.cat.png'
    );
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can go to the next page', async () => {
    await shadowclick(UI.NEXT);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = "view.03.cat-next.png";
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can go back to the previous page', async () => {
    await shadowclick(UI.PREVIOUS);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = "view.04.cat-prev.png";
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different`);
  }).timeout(0);

  it('can zoom in', async () => {
    await shadowclick(UI.ZOOMIN);
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = "view.05.cat-zoom-in.png";
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  // eslint-disable-next-line max-statements
  it('can translate', async () => {
    await shadowclick(UI.NAVIGATE);

    await page.mouse.move(U.width/2, U.height/2);
    await page.mouse.down();
    await page.mouse.move(U.width*2/3, U.height/2, {steps:50});
    await page.mouse.up();
    await page.waitForFunction('Microdraw.isAnimating === false');
    await U.waitUntilHTMLRendered(page);
    const filename = "view.06.cat-zoom-in-translate.png";
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  it('can zoom out', async () => {
    await shadowclick(UI.ZOOMOUT);
    await U.waitUntilHTMLRendered(page);
    const filename = "view.07.cat-zoom-out.png";
    await page.screenshot({path: U.newPath + filename});
    const diff = await U.compareImages(U.newPath + filename, U.refPath + filename);
    assert(diff<U.pct5, `${diff} pixels were different - more than 5%`);
  }).timeout(0);

  after(async () => {
    await browser.close();
  });
});
