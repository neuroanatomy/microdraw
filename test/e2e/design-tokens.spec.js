'use strict';

/*
  UI kit step 5: the app's CSS reads its colours, fonts and radii from
  nwl-components' design tokens (var(--nwl-…)), which every page links from
  partials/header.mustache. Without that link the var() values are invalid and
  these colours fall back to the defaults: transparent, currentColor, none.
  The viewer's stylesheets are in a shadow root, where the tokens arrive by
  inheritance from the page's :root.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

describe('Design tokens (UI kit step 5)', () => {
  let context;
  let page;

  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('defines the tokens on the home page, and the page reads them', async () => {
    await page.goto(U.url('/'), { waitUntil: 'load' });
    const style = await page.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--nwl-bg')
        .trim(),
      background: getComputedStyle(document.body).backgroundColor
    }));
    // --nwl-bg: #1a1a1a, nwl-components 3.0.0's default (#222 before it)
    assert.deepEqual(style, { token: '#1a1a1a', background: 'rgb(26, 26, 26)' });
  }).timeout(U.mediumTimeout);

  it('reaches the viewer in its shadow root', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    const style = await page.evaluate(() => {
      const { dom } = window.Microdraw;

      return {
        menuBarShadow: getComputedStyle(dom.querySelector('#menuBar')).boxShadow,
        buttonBorder: getComputedStyle(dom.querySelector('#home.mui')).borderTopColor,
        buttonRadius: getComputedStyle(dom.querySelector('#home.mui')).borderTopLeftRadius
      };
    });
    assert.deepEqual(style, {
      menuBarShadow: 'rgb(128, 128, 128) 2px 2px 5px 0px',
      buttonBorder: 'rgb(119, 119, 119)',
      buttonRadius: '3px'
    });
  }).timeout(U.mediumTimeout);
});
