'use strict';

/*
  T002 K2b: the toolbar frame is nwl-components' toolsFrame (3.9.0), and the
  script console's look is in its widgets.css, scoped to #logScript. Until then
  codeflask's own <style>s, added to the shadow root after microdraw.css, beat
  microdraw.css, so the console showed codeflask's white theme. It now shows
  light text on the canvas colour, wraps its lines, shows a light caret, takes
  the panel's font size and stays inside #logScript. Computed styles only, no
  pixels.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

let context;
let page;

describe('Script console look (T002 K2b)', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, U.url(DATA_URL));
  });

  after(async () => {
    await H.closeContext(context);
  });

  // eslint-disable-next-line max-statements
  it('shows light text on the canvas colour, wrapping, with a light caret', async () => {
    await page.evaluate(() => window.Microdraw.dom.querySelector('#script').click());
    await page.waitForFunction(() => {
      const d = window.Microdraw.dom;

      return d.querySelector('#logScript .codeflask__flatten') && !d.getElementById('logScript').classList.contains('hidden');
    }, { timeout: U.shortTimeout });

    const look = await page.evaluate(() => {
      const d = window.Microdraw.dom;
      // a token's computed value, as a probe in the shadow root resolves it
      const token = (name) => {
        const probe = document.createElement('div');
        probe.style.color = `var(${name})`;
        d.querySelector('#logScript').appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();

        return value;
      };
      const style = (sel) => getComputedStyle(d.querySelector(sel));
      const flask = style('#logScript .codeflask');
      const flatten = style('#logScript .codeflask__flatten');

      return {
        background: flask.backgroundColor,
        position: flask.position,
        color: style('#logScript .codeflask__code').color,
        whiteSpace: flatten.whiteSpace,
        caretColor: flatten.caretColor,
        fontSize: flatten.fontSize,
        expected: {
          background: token('--nwl-bg-canvas'),
          color: token('--nwl-text'),
          caretColor: token('--nwl-white'),
          fontSize: style('#logScript').fontSize
        }
      };
    });

    assert.equal(look.background, look.expected.background, 'background: --nwl-bg-canvas');
    assert.notEqual(look.background, 'rgb(255, 255, 255)', 'not codeflask\'s white theme');
    assert.equal(look.position, 'relative', 'inside #logScript, not over the text area');
    assert.equal(look.color, look.expected.color, 'text: --nwl-text');
    assert.equal(look.whiteSpace, 'pre-wrap', 'lines wrap');
    assert.equal(look.caretColor, look.expected.caretColor, 'caret: --nwl-white');
    assert.equal(look.fontSize, look.expected.fontSize, 'the panel\'s font size');

    await page.evaluate(() => window.Microdraw.dom.querySelector('#bubble').click());
  }).timeout(U.shortTimeout);
});
