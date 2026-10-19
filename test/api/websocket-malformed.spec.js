'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// F1 (audit 2026-10-19): one WebSocket frame that is not a JSON object used to
// throw out of the message listener and end the whole Node process, HTTP
// server included. Each frame below must be dropped (not relayed), and the
// server must keep accepting connections, relaying chat and answering HTTP.

const open = (port) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});

const nextMessage = (ws) => new Promise((resolve) => {
  ws.once('message', (msg) => resolve(String(msg)));
});

const closed = (ws) => new Promise((resolve) => {
  ws.once('close', resolve);
});

let port, receiver;
const sockets = [];

const connect = async () => {
  const ws = await open(port);
  sockets.push(ws);

  return ws;
};

// A new connection works, the HTTP app answers on both servers.
const assertStillServing = async () => {
  (await connect()).close();
  const res = await chai.request(U.serverURL).get('/')
    .timeout(3000);
  assert.equal(res.status, 200);
  const wsRes = await chai.request(`http://127.0.0.1:${port}`).get('/')
    .timeout(3000);
  assert.equal(wsRes.status, 200);
};

// Frames on one socket are handled in order, so once the chat sent after
// the bad frame arrives, the bad frame has been handled (and not relayed).
const sendThenChat = async (sender, frame, options) => {
  const chat = { type: 'chat', msg: `after ${String(frame)}`, username: 'f1' };
  const received = nextMessage(receiver);
  sender.send(frame, options);
  sender.send(JSON.stringify(chat));
  assert.deepEqual(JSON.parse(await received), chat);
};

describe('Malformed WebSocket messages do not crash the server (F1)', function () {
  before(async function () {
    ({ port } = wsModule.server.address());
    receiver = await connect();
  });

  after(function () {
    sockets.forEach((ws) => ws.terminate());
  });

  for (const frame of ['not json', 'null', '42', '[]', '"text"', 'true']) {
    it(`drops the text frame ${frame}`, async function () {
      const sender = await connect();
      await sendThenChat(sender, frame);
      await assertStillServing();
    }).timeout(U.shortTimeout);
  }

  it('drops a binary frame', async function () {
    const sender = await connect();
    await sendThenChat(sender, Buffer.from([0x00, 0xff, 0x7b]), { binary: true });
    await assertStillServing();
  }).timeout(U.shortTimeout);

  it('relays a JSON object without type, as before', async function () {
    const sender = await connect();
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ msg: 'no type' }));
    assert.deepEqual(JSON.parse(await received), { msg: 'no type' });
    await assertStillServing();
  }).timeout(U.shortTimeout);

  // ws emits 'error' on the server socket for a protocol error (here a text
  // frame that is not UTF-8); with no 'error' listener that throws.
  it('closes a socket that sends invalid UTF-8, keeps serving', async function () {
    const sender = await connect();
    const done = closed(sender);
    sender.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
    await done;
    await sendThenChat(await connect(), 'not json');
    await assertStillServing();
  }).timeout(U.shortTimeout);
});
