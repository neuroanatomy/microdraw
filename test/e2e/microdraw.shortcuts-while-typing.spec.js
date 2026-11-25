'use strict';
const UI = require('../UI');
const U = require('../mocha.test.util');
const { assert } = require('chai');
const H = require('./helpers');

/*
  T002 F1: the viewer's shortcuts do nothing while the user types in a text
  entry (here the chat input): Backspace and Delete edit the text instead of
  deleting the selected region, Cmd/Ctrl-Z doesn't undo a drawing step, and
  the arrows move the caret instead of the slice. With the focus elsewhere,
  the shortcuts still work.
*/

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

let context;
let page;

const shadowclick = async (sel) => {
  const handle = await page.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
  await handle.click();
};

const state = () => page.evaluate(() => {
  const M = window.Microdraw;

  return {
    regions: M.ImageInfo[M.currentImage].Regions.length,
    selected: Boolean(M.region),
    undo: M.UndoStack.length,
    slice: M.imageOrder.indexOf(M.currentImage),
    text: M.dom.querySelector('input#msg').value
  };
});

// the key the viewer deletes the selected region with: Backspace on a Mac, Delete elsewhere
const deleteKey = () => page.evaluate(() => (window.Microdraw.isMac ? 'Backspace' : 'Delete'));

const pressShortcut = async (key) => {
  const modifier = await page.evaluate(() => (window.Microdraw.isMac ? 'Meta' : 'Control'));
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
};

const drawTriangle = async () => {
  await shadowclick(UI.DRAWPOLYGON);
  for (const [x, y] of [[300, 300], [400, 300], [350, 400], [300, 300]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.click(x, y);
  }
};

const selectRegion = () => page.evaluate(() => {
  const M = window.Microdraw;
  M.selectRegion(M.ImageInfo[M.currentImage].Regions[0]);
});

describe('Viewer shortcuts while typing (T002 F1)', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, U.url(DATA_URL));
    await drawTriangle();
    await selectRegion();
    const input = await page.evaluateHandle(() => window.Microdraw.dom.querySelector('input#msg'));
    await input.click();
    await input.type('abc');
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('Backspace and Delete in the chat edit the text, and keep the selected region', async () => {
    const before = await state();
    assert.deepEqual(before, { regions: 1, selected: true, undo: before.undo, slice: 0, text: 'abc' });
    await page.keyboard.press('Backspace');
    assert.equal((await state()).text, 'ab');
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    assert.deepEqual(await state(), { ...before, text: 'b' });
  }).timeout(U.shortTimeout);

  it('→ and ← in the chat move the caret, not the slice', async () => {
    const before = await state();
    // the caret is before "b": → puts it after
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('x');
    assert.deepEqual(await state(), { ...before, text: 'bx' });
    // ← puts it back before "x"
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('y');
    assert.deepEqual(await state(), { ...before, text: 'byx' });
  }).timeout(U.shortTimeout);

  it('Cmd/Ctrl-Z in the chat does not undo a drawing step', async () => {
    const before = await state();
    await pressShortcut('KeyZ');
    const after = await state();
    assert.equal(after.undo, before.undo, 'undo stack');
    assert.equal(after.regions, 1, 'regions');
  }).timeout(U.shortTimeout);

  it('with the focus out of the text entry, Delete deletes the region and → moves to the next slice', async () => {
    await page.evaluate(() => window.Microdraw.dom.activeElement.blur());
    await selectRegion();
    await page.keyboard.press(await deleteKey());
    assert.equal((await state()).regions, 0, 'the region was not deleted');
    await page.keyboard.press('ArrowRight');
    await H.waitForMicrodraw(page, 1);
    assert.equal((await state()).slice, 1);
  }).timeout(U.shortTimeout);
});
