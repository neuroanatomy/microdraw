'use strict';

/*
  M4c: the landing page's script (app/views/index.mustache), recorded on its
  jQuery 1.11 version (2026-10-13) and kept unchanged on the jQuery-free one.
  The Go button is in microdraw.interaction.spec.js.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

describe('Landing page (M4c)', () => {
  let context;
  let page;

  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await page.goto(U.url('/'), { waitUntil: 'load' });
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('makes the slide as tall as the window, and follows a resize', async () => {
    assert.equal(await page.$eval('.slide', (el) => el.style.height), `${U.height}px`);
    await page.setViewport({ width: U.width + 100, height: U.height + 50 });
    await page.waitForFunction((h) => document.querySelector('.slide').style.height === `${h}px`, { timeout: U.shortTimeout }, U.height + 50);
    assert.equal(await page.$eval('#neurons', (el) => el.style.width), `${U.width + 100}px`);
    await page.setViewport({ width: U.width, height: U.height });
    await page.waitForFunction((h) => document.querySelector('.slide').style.height === `${h}px`, { timeout: U.shortTimeout }, U.height);
  }).timeout(U.shortTimeout);

  it('slides the subtitle in', async () => {
    const style = await page.$eval('h2', (el) => ({ marginLeft: el.style.marginLeft, opacity: el.style.opacity }));
    assert.deepEqual(style, { marginLeft: '0px', opacity: '1' });
  }).timeout(U.shortTimeout);

  it('copies the dataset chosen in the list into the URL field', async () => {
    const value = 'https://microdraw.pasteur.fr/vervet/vervet.json';
    await page.select('#list', value);
    assert.equal(await page.$eval('#url', (el) => el.value), value);
  }).timeout(U.shortTimeout);

  it('hides the menu when the page is scrolled down, and shows it again at the top', async () => {
    const menu = () => page.$eval('#menu', (el) => ({ top: el.style.top, opacity: el.style.opacity }));
    // the page is one window tall: make room to scroll
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'm4-spacer';
      spacer.style.height = '1000px';
      document.body.appendChild(spacer);
      window.scrollTo(0, 300);
    });
    await page.waitForFunction(() => document.querySelector('#menu').style.top === '-32px', { timeout: U.shortTimeout });
    assert.deepEqual(await menu(), { top: '-32px', opacity: '0' });
    assert.deepEqual(await page.$eval('#footer', (el) => [el.style.display, getComputedStyle(el).display]), ['', 'block']);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('#menu').style.top === '0px', { timeout: U.shortTimeout });
    assert.deepEqual(await menu(), { top: '0px', opacity: '1' });
    await page.evaluate(() => document.querySelector('#m4-spacer').remove());
  }).timeout(U.shortTimeout);

  it('opens the URL typed in the field when Enter is pressed', async () => {
    await page.$eval('#url', (el) => { el.value = ''; });
    await page.type('#url', '/test_data/cat.json');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.keyboard.press('Enter')]);
    const url = new URL(page.url());
    assert.equal(url.pathname, '/data');
    assert.equal(url.searchParams.get('source'), '/test_data/cat.json');
  }).timeout(U.shortTimeout);
});
