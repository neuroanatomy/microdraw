'use strict';

const { assert } = require('chai');
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// The WebSocket server relays a chat message as a new JSON object built from
// known fields, with JSON.stringify. The text is not sanitised as HTML any
// more (DOMPurify on the JSON string changed the text and could break the
// JSON): it arrives as it was sent, and the viewer shows it as text.

const open = (port) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});

const nextMessage = (ws) => new Promise((resolve) => {
  ws.once('message', (msg) => resolve(String(msg)));
});

describe('WebSocket chat text is relayed unchanged', function () {
  let receiver, sender;

  before(async function () {
    const { port } = wsModule.server.address();
    sender = await open(port);
    receiver = await open(port);
  });

  after(function () {
    [sender, receiver].filter(Boolean).forEach((ws) => ws.close());
  });

  const broadcast = async (msg) => {
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg, username: 'm5b' }));

    return JSON.parse(await received);
  };

  it('passes a plain chat message unchanged', async function () {
    assert.deepEqual(await broadcast('hello é ✓'), { type: 'chat', msg: 'hello é ✓', username: 'Anonymous' });
  }).timeout(U.shortTimeout);

  it('keeps &, < and > as they are', async function () {
    assert.equal((await broadcast('a & b < c > d')).msg, 'a & b < c > d');
  }).timeout(U.shortTimeout);

  it('keeps markup as text: event handlers, scripts, comments', async function () {
    for (const text of [
      '<img src=x onerror=alert(1)> & co',
      '<script>alert(1)</script>ok',
      '<!-- c -->k',
      '<p>para</p>',
      '</script><svg onload=alert(1)>',
      // eslint-disable-next-line no-script-url -- the payload under test
      '<a href="javascript:alert(1)">l</a>'
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one message at a time
      assert.equal((await broadcast(text)).msg, text);
    }
  }).timeout(U.shortTimeout);
});
