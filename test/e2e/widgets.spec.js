'use strict';

/*
  UI kit step 9a (nwl-components 2.1.0, widgets.css): the pages use the kit's
  push button (U3: bold, `padding: 5px 0`; U7: a lighter background on hover),
  icon and selected row (U5: `aria-selected="true"`), and links drawn without
  an underline get one on hover (U8). header.mustache links widgets.css; the
  viewer's shadow root links it too, since rules don't inherit into it.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const project = U.createPublicAnnotationProject('e2ewidgets');

describe('Widgets (UI kit step 9a)', () => {
  let context;
  let page;

  before(async () => {
    await U.insertProject({ ...project });
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    // DB cleanup in finally: a crashed browser must not skip it
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  it('draws the home page\'s Go push button bold, padded 5px, with a lighter background on hover', async () => {
    await page.goto(U.url('/'), { waitUntil: 'load' });
    const style = () => page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#go'));

      return { weight: cs.fontWeight, padding: cs.padding, background: cs.backgroundColor, opacity: cs.opacity };
    });
    assert.deepEqual(await style(), { weight: '700', padding: '5px 0px', background: 'rgba(0, 0, 0, 0)', opacity: '1' });
    await page.hover('#go');
    // --nwl-bg-pressed: #404040, nwl-components 3.0.0's default (#555 before it)
    assert.deepEqual(await style(), { weight: '700', padding: '5px 0px', background: 'rgb(64, 64, 64)', opacity: '1' });
  }).timeout(U.mediumTimeout);

  it('underlines the footer link, drawn without an underline, on hover', async () => {
    await page.goto(U.url('/'), { waitUntil: 'load' });
    const line = () => page.evaluate(() => getComputedStyle(document.querySelector('#footer a.linkNoULine')).textDecorationLine);
    assert.equal(await line(), 'none');
    await page.hover('#footer a.linkNoULine');
    assert.equal(await line(), 'underline');
  }).timeout(U.mediumTimeout);

  it('marks the open file\'s row aria-selected="true", and the kit gives it its background', async () => {
    await page.goto(U.url(`/project/${project.shortname}?source=/test_data/cat.json&project=${project.shortname}`), { waitUntil: 'load' });
    await page.waitForSelector('#projectFiles tbody tr.selected', { timeout: U.shortTimeout });
    const rows = await page.evaluate(() => [...document.querySelectorAll('#projectFiles tbody tr')]
      .map((tr) => [tr.getAttribute('aria-selected'), getComputedStyle(tr).backgroundColor]));
    // --nwl-bg-elevated: #2e2e2e, nwl-components 3.0.0's default (#444 before it)
    assert.deepEqual(rows, [['true', 'rgb(46, 46, 46)'], ['false', 'rgba(0, 0, 0, 0)']]);
  }).timeout(U.mediumTimeout);

  it('gives the kit\'s icon rules to the tool icons in the viewer\'s shadow root', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    const style = await page.evaluate(() => {
      const cs = getComputedStyle(window.Microdraw.dom.querySelector('#home img.nwl-icon'));

      return { verticalAlign: cs.verticalAlign, userSelect: cs.userSelect };
    });
    assert.deepEqual(style, { verticalAlign: 'middle', userSelect: 'none' });
  }).timeout(U.mediumTimeout);
});
