'use strict';
const UI = require('../UI');
const U = require('../mocha.test.util');
const chai = require('chai');
const {assert} = chai;
const H = require('./helpers');
const WebSocket = require('ws');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

/*
  Ways into the viewer other than the toolbar: the landing page's Go button,
  keyboard shortcuts, the slice slider, saving with nothing to save, and the
  WebSocket chat between two pages. Added on 2026-10-12 (T0.5b).
*/

const DATA_URL = '/data?source=/test_data/cat.json&slice=0';

let context;
let page;

const shadowclick = async function (sel, p = page) {
  const handle = await p.evaluateHandle((s) => document.querySelector("#content").shadowRoot.querySelector(s), sel);
  await handle.click();
};

const undoState = (p = page) => p.evaluate(() => ({
  undo: window.Microdraw.UndoStack.length,
  redo: window.Microdraw.RedoStack.length
}));

// Press a shortcut with the platform's modifier, as Microdraw expects it (cmd on a Mac, ctrl elsewhere).
const pressShortcut = async (key, shift = false) => {
  const modifier = await page.evaluate(() => (window.Microdraw.isMac ? 'Meta' : 'Control'));
  await page.keyboard.down(modifier);
  if (shift) { await page.keyboard.down('Shift'); }
  await page.keyboard.press(key);
  if (shift) { await page.keyboard.up('Shift'); }
  await page.keyboard.up(modifier);
};

const sliceState = (p = page) => p.evaluate(() => ({
  slice: window.Microdraw.imageOrder.indexOf(window.Microdraw.currentImage),
  label: window.Microdraw.dom.querySelector('#slice-number').textContent,
  url: new URLSearchParams(location.search).get('slice')
}));

// Send one message from a WebSocket connection outside the viewer.
const sendChat = async (data) => {
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsModule.server.address().port}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
  ws.send(JSON.stringify(data));
  ws.close();
};

describe('Viewer interactions', () => {
  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({width: U.width, height: U.height});
  });

  after(async () => {
    await H.closeContext(context);
  });

  it('the landing page Go button opens the URL typed in the field', async () => {
    await H.instrumentPage(page);
    await page.goto(U.url(''), { waitUntil: 'load' });
    await page.type('#url', '/test_data/cat.json');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#go')]);

    const url = new URL(page.url());
    assert.equal(url.pathname, '/data');
    assert.equal(url.searchParams.get('source'), '/test_data/cat.json');
    // with no slice in the URL, Microdraw opens the middle slice (index 1 of 2) and adds it to the URL
    await H.waitForMicrodraw(page, 1);
    assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('undoes and redoes with the keyboard', async () => {
    await H.openData(page, U.url(DATA_URL));
    await shadowclick(UI.DRAWPOLYGON);
    for (const [x, y] of [[300, 300], [400, 300], [350, 400], [300, 300]]) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(x, y);
    }
    const drawn = await H.regionState(page);
    const before = await undoState();
    assert.lengthOf(drawn, 1);
    assert.isAbove(before.undo, 0);

    await pressShortcut('KeyZ');
    const undone = await undoState();
    assert.deepEqual(undone, { undo: before.undo - 1, redo: 1 }, 'undo shortcut');
    assert.notDeepEqual(await H.regionState(page), drawn, 'undo shortcut did not change the region');

    await pressShortcut('KeyZ', true);
    assert.deepEqual(await undoState(), { undo: before.undo, redo: 0 }, 'redo shortcut');
    const redone = await H.regionState(page);
    assert.lengthOf(redone, 1);
    assert.equal(redone[0].segments, drawn[0].segments);
    assert.equal(redone[0].closed, drawn[0].closed);
  }).timeout(U.shortTimeout);

  it('changes slice with the right and left arrow keys', async () => {
    await H.openData(page, U.url(DATA_URL));
    await page.keyboard.press('ArrowRight');
    await H.waitForMicrodraw(page, 1);
    assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });

    await page.keyboard.press('ArrowLeft');
    await H.waitForMicrodraw(page, 0);
    assert.deepEqual(await sliceState(), { slice: 0, label: 'Slice 0', url: '0' });
  }).timeout(U.shortTimeout);

  it('changes slice with the slider', async () => {
    await H.openData(page, U.url(DATA_URL));
    const { track, thumb } = await page.evaluate(() => {
      const box = (sel) => {
        const b = window.Microdraw.dom.querySelector(sel).getBoundingClientRect();

        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };

      return { track: box('#slice .mui-track'), thumb: box('#slice .mui-thumb') };
    });
    // drag the thumb past the end of the track: the last slice
    await page.mouse.move(thumb.x + (thumb.width/2), thumb.y + (thumb.height/2));
    await page.mouse.down();
    await page.mouse.move(track.x + track.width + 5, track.y + (track.height/2), { steps: 5 });
    await page.mouse.up();

    await H.waitForMicrodraw(page, 1);
    assert.deepEqual(await sliceState(), { slice: 1, label: 'Slice 1', url: '1' });
  }).timeout(U.shortTimeout);

  it('says there is nothing to save when nothing changed', async () => {
    await H.openData(page, U.url(DATA_URL));
    const posts = [];
    const onRequest = (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api') { posts.push(req.url()); }
    };
    page.on('request', onRequest);

    await shadowclick(UI.SAVE);
    await page.waitForFunction(() => {
      const dialog = window.Microdraw.dom.querySelector('#saveDialog');

      return getComputedStyle(dialog).display !== 'none' && dialog.textContent === 'No changes to save';
    }, { timeout: U.shortTimeout });
    page.off('request', onRequest);
    assert.lengthOf(posts, 0, 'a save request was sent');
    await H.waitForTools(page);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('sends a chat message from one page to another over the WebSocket', async () => {
    const page2 = await context.newPage();
    await page2.setViewport({width: U.width, height: U.height});
    // each page must be in front while it loads: background pages get no animation frames
    for (const p of [page, page2]) {
      // eslint-disable-next-line no-await-in-loop
      await p.bringToFront();
      // eslint-disable-next-line no-await-in-loop
      await H.openData(p, U.url(DATA_URL));
      // eslint-disable-next-line no-await-in-loop
      await p.waitForFunction(() => window.Microdraw.dom.querySelector('#notifications').innerHTML === 'Chat', { timeout: U.shortTimeout });
    }

    const message = `hello from page 1, ${Date.now()}`;
    await page.bringToFront();
    const input = await page.evaluateHandle(() => window.Microdraw.dom.querySelector('input#msg'));
    await input.click();
    await input.type(message);
    await page.keyboard.press('Enter');

    await page2.waitForFunction((m) => window.Microdraw.dom.querySelector('#logChat .text').textContent.includes(m), { timeout: U.shortTimeout }, message);
    const received = await page2.evaluate(() => window.Microdraw.dom.querySelector('#logChat .text').innerHTML);
    assert.notInclude(received, '(me)', 'page 2 shows the message as its own');
    const own = await page.evaluate(() => window.Microdraw.dom.querySelector('#logChat .text').innerHTML);
    assert.include(own, `<i>(me)</i>: ${message}`);
    // logged out, both lines show the sender's animal nickname, not Anonymous
    const names = await Promise.all([page, page2].map((p) => p.evaluate(() => [...window.Microdraw.dom.querySelectorAll('#logChat .text b')].map((b) => b.textContent)
      .pop())));
    assert.equal(names[1], `${names[0]}:`, 'the received name is not the own nickname');
    assert.notEqual(names[0], 'Anonymous');
    await page2.close();
  }).timeout(U.mediumTimeout);

  it("shows an anonymous sender's animal nickname, whatever name it sent", async () => {
    const msg = `animal ${Date.now()}`;
    await sendChat({ type: 'chat', msg, username: 'mallory', randomUuid: 1234 });
    await page.waitForFunction((m) => window.Microdraw.dom.querySelector('#logChat .text').textContent.includes(m), { timeout: U.shortTimeout }, msg);
    const { name, nickname } = await page.evaluate(() => ({
      name: [...window.Microdraw.dom.querySelectorAll('#logChat .text b')].pop().textContent,
      // what _decodeRandomUuidToNickname(1234) gives
      nickname: window.HippyHippo.HippyHippo.getNickName(1234)
    }));
    assert.isString(nickname);
    assert.equal(name, `${nickname}:`);
  }).timeout(U.mediumTimeout);

  it('shows a received chat message with markup as text', async () => {
    await page.bringToFront();
    await H.openData(page, U.url(DATA_URL));
    await page.waitForFunction(() => window.Microdraw.dom.querySelector('#notifications').innerHTML === 'Chat', { timeout: U.shortTimeout });
    const markup = `<img src=x onerror="window.__chatInjected=true"><b>bold</b> & co ${Date.now()}`;
    await sendChat({ type: 'chat', msg: markup, username: '<i>name</i>' });
    await page.waitForFunction((m) => window.Microdraw.dom.querySelector('#logChat .text').textContent.includes(m), { timeout: U.shortTimeout }, markup);
    const shown = await page.evaluate(() => {
      const log = window.Microdraw.dom.querySelector('#logChat .text');

      return {
        img: log.querySelectorAll('img').length,
        bold: [...log.querySelectorAll('b')].map((b) => b.textContent),
        injected: window.__chatInjected === true
      };
    });
    assert.deepInclude(shown, { img: 0, injected: false }, 'the markup made an img element, or its onerror ran');
    assert.notInclude(shown.bold, 'bold', 'the markup made a bold element');
    assert.include(shown.bold, 'Anonymous:', 'the server names the logged-out sender');
  }).timeout(U.mediumTimeout);
});
