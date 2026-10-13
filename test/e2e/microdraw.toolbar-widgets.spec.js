'use strict';

/*
  M4b: the toolbar widgets microdraw builds with muijs (MUI.slider, chose,
  chose3state, toggle, push), with the mouse and on a touch screen. Recorded on
  muijs 0.1.3 with jQuery 1.11 (2026-10-13) and kept unchanged on the
  jQuery-free port (app/public/js/mui.js). The slider's mouse drag past the end
  is also in microdraw.interaction.spec.js.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

// An iPad in landscape: touch, mobile viewport
const TABLET = { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

let context;
let page;

const inShadow = (p, sel) => p.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
const shadowClick = async (sel, p = page) => { await (await inShadow(p, sel)).click(); };

const sliceState = (p = page) => p.evaluate(() => ({
  slice: window.Microdraw.imageOrder.indexOf(window.Microdraw.currentImage),
  label: window.Microdraw.dom.querySelector('#slice-number').textContent,
  url: new URLSearchParams(location.search).get('slice')
}));

const sliderBoxes = (p = page) => p.evaluate(() => {
  const box = (sel) => {
    const b = window.Microdraw.dom.querySelector(sel).getBoundingClientRect();

    return { x: b.x, y: b.y, width: b.width, height: b.height };
  };

  return { track: box('#slice .mui-track'), thumb: box('#slice .mui-thumb') };
});

// The thumb's CSS left, in % of the track (rounded: pointer positions are whole pixels)
const thumbLeft = (p = page) => p.evaluate(() => Math.round(parseFloat(window.Microdraw.dom.querySelector('#slice .mui-thumb').style.left)));
const waitForThumb = (p, percent) => p.waitForFunction(
  (v) => Math.round(parseFloat(window.Microdraw.dom.querySelector('#slice .mui-thumb').style.left)) === v,
  { timeout: U.shortTimeout },
  percent
);

const pressed = (container) => page.evaluate((c) => Array.from(window.Microdraw.dom.querySelectorAll(`${c} .mui`))
  .filter((el) => el.classList.contains('mui-pressed'))
  .map((el) => el.id), container);

describe('Toolbar widgets (M4b)', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    await H.closeContext(context);
  });

  describe('slider', () => {
    // eslint-disable-next-line max-statements
    it('follows a mouse drag continuously, and loads the slice on release', async () => {
      await H.openData(page, U.url(DATA_URL));
      const { track, thumb } = await sliderBoxes();
      await page.mouse.move(thumb.x + (thumb.width / 2), thumb.y + (thumb.height / 2));
      await page.mouse.down();
      await page.mouse.move(track.x + (track.width * 0.75), track.y, { steps: 3 });

      // while dragging: the thumb and the label follow, the slice is not loaded yet
      const left = await thumbLeft();
      let state = await sliceState();
      await page.mouse.up();
      assert.equal(left, 75);
      assert.deepEqual(state, { slice: 0, label: 'Slice 1', url: '0' });

      await H.waitForMicrodraw(page, 1);
      state = await sliceState();
      assert.deepEqual(state, { slice: 1, label: 'Slice 1', url: '1' });
      // the thumb stays where it was dropped (only previous/next and the arrow keys move it)
      assert.equal(await thumbLeft(), 75);
    }).timeout(U.mediumTimeout);

    it('goes to the first slice when dragged before the start of the track', async () => {
      const { track, thumb } = await sliderBoxes();
      await page.mouse.move(thumb.x + (thumb.width / 2), thumb.y + (thumb.height / 2));
      await page.mouse.down();
      await page.mouse.move(track.x - 30, track.y, { steps: 3 });
      const left = await thumbLeft();
      await page.mouse.up();
      assert.equal(left, 0);
      await H.waitForMicrodraw(page, 0);
      assert.deepEqual(await sliceState(), { slice: 0, label: 'Slice 0', url: '0' });
    }).timeout(U.mediumTimeout);

    it('jumps to where the track is clicked', async () => {
      const { track } = await sliderBoxes();
      await page.mouse.click(track.x + (track.width * 0.9), track.y);
      await H.waitForMicrodraw(page, 1);
      assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });
    }).timeout(U.mediumTimeout);

    it('ignores a mouse release that did not start on the slider', async () => {
      await page.mouse.click(500, 400);
      await H.settleFrames(page);
      assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });
    }).timeout(U.mediumTimeout);
  });

  describe('chose: the click tools', () => {
    it('presses the chosen tool only, and selects it', async () => {
      assert.deepEqual(await pressed('#clickTool'), ['navigate']);
      await shadowClick('#draw');
      assert.deepEqual(await pressed('#clickTool'), ['draw']);
      assert.equal(await page.evaluate(() => window.Microdraw.selectedTool), 'draw');
    }).timeout(U.shortTimeout);

    it('selects the pressed tool again when it is clicked again', async () => {
      await page.evaluate(() => { window.Microdraw.selectedTool = 'not-a-tool'; });
      await shadowClick('#draw');
      assert.deepEqual(await pressed('#clickTool'), ['draw']);
      assert.equal(await page.evaluate(() => window.Microdraw.selectedTool), 'draw');
      await shadowClick('#navigate');
      assert.deepEqual(await pressed('#clickTool'), ['navigate']);
      assert.equal(await page.evaluate(() => window.Microdraw.selectedTool), 'navigate');
    }).timeout(U.shortTimeout);
  });

  describe('chose3state: chat and script', () => {
    const textState = () => page.evaluate(() => {
      const d = window.Microdraw.dom;

      return {
        block: d.querySelector('#textInputBlock').style.display,
        chat: !d.getElementById('logChat').classList.contains('hidden'),
        script: !d.getElementById('logScript').classList.contains('hidden')
      };
    });

    it('switches to the script, then hides both when pressed again, then back to the chat', async () => {
      assert.deepEqual(await pressed('#text'), ['bubble']);

      await shadowClick('#script');
      assert.deepEqual(await pressed('#text'), ['script']);
      // shown as flex since M4e (block before), so that it can be resized
      assert.deepEqual(await textState(), { block: 'flex', chat: false, script: true });

      await shadowClick('#script');
      assert.deepEqual(await pressed('#text'), []);
      assert.equal((await textState()).block, 'none');

      await shadowClick('#bubble');
      assert.deepEqual(await pressed('#text'), ['bubble']);
      assert.deepEqual(await textState(), { block: 'flex', chat: true, script: false });
    }).timeout(U.shortTimeout);
  });

  describe('toggle: fullscreen', () => {
    it('presses the button and enters fullscreen, then leaves it', async () => {
      const state = () => page.evaluate(() => ({
        pressed: window.Microdraw.dom.querySelector('#fullscreen').classList.contains('mui-pressed'),
        position: document.querySelector('#content').style.position
      }));
      await shadowClick('#fullscreen');
      await H.waitForTools(page);
      assert.deepEqual(await state(), { pressed: true, position: 'fixed' });
      await shadowClick('#fullscreen');
      await H.waitForTools(page);
      assert.deepEqual(await state(), { pressed: false, position: '' });
    }).timeout(U.shortTimeout);
  });

  describe('push: toolbar display and slice buttons', () => {
    const display = () => page.evaluate(() => {
      const d = window.Microdraw.dom;
      const bar = d.querySelector('#menuBar').getBoundingClientRect();

      return {
        maximized: d.querySelector('#tools-maximized').style.display,
        minimized: d.querySelector('#tools-minimized').style.display,
        side: d.querySelector('body').getAttribute('data-toolbarDisplay'),
        left: Math.round(bar.left),
        right: Math.round(window.innerWidth - bar.right)
      };
    });

    it('minimizes the toolbar and brings it back', async () => {
      await shadowClick('#display-minimize');
      const min = await display();
      assert.equal(min.maximized, 'none');
      assert.equal(min.minimized, 'block');
      // the round button: #tools-minimized itself has no size
      await shadowClick('#tools-minimized > div');
      const max = await display();
      assert.equal(max.maximized, 'block');
      assert.equal(max.minimized, 'none');
    }).timeout(U.shortTimeout);

    it('docks the toolbar right, then left', async () => {
      await shadowClick('#display-right');
      let d = await display();
      assert.equal(d.side, 'right');
      assert.equal(d.right, 0);
      await shadowClick('#display-left');
      d = await display();
      assert.equal(d.side, 'left');
      assert.equal(d.left, 5);
    }).timeout(U.shortTimeout);

    it('goes to the previous and next slices', async () => {
      await shadowClick('#previous');
      await H.waitForMicrodraw(page, 0);
      assert.deepEqual(await sliceState(), { slice: 0, label: 'Slice 0', url: '0' });
      await shadowClick('#next');
      await H.waitForMicrodraw(page, 1);
      assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });
    }).timeout(U.mediumTimeout);
  });

  describe('on a tablet', () => {
    let tab;
    before(async () => {
      tab = await context.newPage();
      await tab.setViewport(TABLET);
    });
    after(async () => {
      await tab.close();
    });

    // eslint-disable-next-line max-statements
    it('drags the slider with a finger', async () => {
      await tab.bringToFront();
      await H.openData(tab, U.url(DATA_URL));
      const { track, thumb } = await sliderBoxes(tab);
      const y = thumb.y + (thumb.height / 2);
      await tab.touchscreen.touchStart(thumb.x + (thumb.width / 2), y);
      await tab.touchscreen.touchMove(track.x + (track.width * 0.5), y);
      await tab.touchscreen.touchMove(track.x + (track.width * 0.75), y);
      try {
        await waitForThumb(tab, 75);
        assert.deepEqual(await sliceState(tab), { slice: 0, label: 'Slice 1', url: '0' });
      } finally {
        await tab.touchscreen.touchEnd();
      }
      await H.waitForMicrodraw(tab, 1);
      assert.deepEqual(await sliceState(tab), { slice: 1, label: 'Slice 1', url: '1' });

      // and back to the start
      const boxes = await sliderBoxes(tab);
      await tab.touchscreen.touchStart(boxes.thumb.x + (boxes.thumb.width / 2), y);
      await tab.touchscreen.touchMove(boxes.track.x - 30, y);
      await tab.touchscreen.touchEnd();
      await H.waitForMicrodraw(tab, 0);
      assert.deepEqual(await sliceState(tab), { slice: 0, label: 'Slice 0', url: '0' });
    }).timeout(U.mediumTimeout);

    it('taps the tool buttons', async () => {
      await (await inShadow(tab, '#draw')).tap();
      assert.equal(await tab.evaluate(() => window.Microdraw.selectedTool), 'draw');
      await (await inShadow(tab, '#script')).tap();
      assert.equal(await tab.evaluate(() => window.Microdraw.dom.querySelector('#textInputBlock').style.display), 'flex');
      assert.isTrue(await tab.evaluate(() => window.Microdraw.dom.querySelector('#script').classList.contains('mui-pressed')));
      await (await inShadow(tab, '#next')).tap();
      await H.waitForMicrodraw(tab, 1);
      assert.equal((await sliceState(tab)).slice, 1);
    }).timeout(U.mediumTimeout);
  });
});
