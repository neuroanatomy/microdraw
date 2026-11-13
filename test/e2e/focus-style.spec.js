'use strict';

/*
  UI kit step 7 (nwl-components 2.0.0, decision U6): keyboard focus shows a
  2px var(--nwl-focus) outline, mouse focus shows none. The viewer is in a
  shadow root, which nwl-components' base.css does not reach: microdraw.css
  gives its controls the outline. (Its tool buttons are native buttons since
  step 9b: tool-buttons.spec.js.)

  With 2.0.0 the library's CSS is in cascade layers, below the app's own
  unlayered CSS: shared-style.css's `input { color }` then made the
  new-project name field's text white on its white background.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const user = { username: 'e2e-focus-user', password: 'e2e-focus-user-password' };

const focusState = (page) => page.evaluate(() => {
  const el = window.Microdraw.dom.activeElement;
  const cs = el && getComputedStyle(el);

  // outline-width computes to 3px (medium) when the style is none
  return el && { tag: el.tagName, text: el.textContent.trim(), outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
});

describe('Focus style and form colours (UI kit step 7)', () => {
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

  it('shows no outline on a viewer button focused with the mouse, a 2px one with the keyboard', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    const inViewer = (selector) => page.evaluateHandle((sel) => window.Microdraw.dom.querySelector(sel), selector);
    await (await inViewer('#layers.mui')).click(); // opens the layers panel
    await (await inViewer('#add-layer-button')).click();
    assert.deepEqual(await focusState(page), { tag: 'BUTTON', text: 'Add layer', outline: 'none' }, 'mouse focus');

    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.deepEqual(await focusState(page), { tag: 'BUTTON', text: 'Cancel', outline: 'solid 2px rgb(255, 255, 255)' }, 'keyboard focus');
  }).timeout(U.mediumTimeout);

  it('writes the new project\'s name in a colour other than its background', async () => {
    await H.logIn(page, user);
    await page.goto(U.url('/project/new'), { waitUntil: 'load' });
    await page.waitForSelector('#app main input');
    const style = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#app main input'));

      return { color: cs.color, background: cs.backgroundColor };
    });
    assert.notEqual(style.color, style.background);
    assert.equal(style.color, 'rgb(0, 0, 0)');
  }).timeout(U.mediumTimeout);
});
