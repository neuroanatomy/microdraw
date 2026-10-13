'use strict';

const { assert } = require('chai');
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// M5b (dompurify 2 → 3): the WebSocket server broadcasts every message to the
// other clients as DOMPurify.sanitize(JSON.stringify(data)). These tests pin
// what that sanitising does, so a DOMPurify upgrade can't change it unseen.
// Recorded on dompurify 2.5.9 (2026-10-13).

const open = (port) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});

const nextMessage = (ws) => new Promise((resolve) => {
  ws.once('message', (msg) => resolve(String(msg)));
});

describe('WebSocket broadcast sanitising (M5b)', function () {
  let receiver, sender;

  before(async function () {
    const { port } = wsModule.server.address();
    sender = await open(port);
    receiver = await open(port);
  });

  after(function () {
    [sender, receiver].filter(Boolean).forEach((ws) => ws.close());
  });

  const broadcast = (msg) => {
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg, username: 'm5b' }));

    return received;
  };

  it('passes a plain chat message unchanged', async function () {
    const text = await broadcast('hello é ✓');
    assert.deepEqual(JSON.parse(text), { type: 'chat', msg: 'hello é ✓', username: 'm5b' });
  }).timeout(U.shortTimeout);

  it('escapes &, < and > as HTML entities', async function () {
    const text = await broadcast('a & b < c > d');
    assert.equal(JSON.parse(text).msg, 'a &amp; b &lt; c &gt; d');
  }).timeout(U.shortTimeout);

  it('removes event handlers, scripts and comments, keeps harmless markup', async function () {
    assert.equal(await broadcast('<img src=x onerror=alert(1)>hi'),
      '{"type":"chat","msg":"<img src="x">hi","username":"m5b"}');
    assert.equal(JSON.parse(await broadcast('<script>alert(1)</script>ok')).msg, 'ok');
    assert.equal(JSON.parse(await broadcast('<!-- c -->k')).msg, 'k');
    assert.equal(JSON.parse(await broadcast('<p>para</p>')).msg, '<p>para</p>');
    const svg = await broadcast('</script><svg onload=alert(1)>');
    assert.notInclude(svg, 'onload');
    assert.notInclude(svg, '</script>');
  }).timeout(U.shortTimeout);

  // In the JSON text the quotes around an href are escaped, so the attribute
  // value starts with a backslash and is not a javascript: URL any more.
  it('keeps a javascript: link inert (escaped quotes)', async function () {
    // eslint-disable-next-line no-script-url -- the payload under test
    const text = await broadcast('<a href="javascript:alert(1)">l</a>');
    assert.equal(text, String.raw`{"type":"chat","msg":"<a href="\&quot;javascript:alert(1)\&quot;">l</a>","username":"m5b"}`);
  }).timeout(U.shortTimeout);
});
