'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// The chat stays global: every other connection gets each chat message. The
// server relays only chat messages, rebuilt from known fields: the sender's
// name is the session user of its connection (the cookie of the upgrade
// request), or 'Anonymous', never the username in the message.
//
// "Not relayed" is checked without waiting: a chat sent after the message on
// the same connection is relayed after it, so the next message received is
// that chat.
// eslint-disable-next-line max-statements
describe('WebSocket chat: the server names the sender, relays only chat', function () {
  const alice = { username: 'wschatalice', password: 'ws-chat-alice-password' };
  const sockets = [];
  let cookie, port, receiver;
  let count = 0;

  // a connection that keeps every message it gets, in order
  const open = (headers = {}) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.inbox = [];
    ws.waiting = [];
    ws.on('message', (msg) => {
      const data = JSON.parse(String(msg));
      const waiter = ws.waiting.shift();
      if (waiter) {
        waiter(data);
      } else {
        ws.inbox.push(data);
      }
    });
    ws.once('open', () => {
      sockets.push(ws);
      resolve(ws);
    });
    ws.once('error', reject);
  });

  const nextMessage = (ws) => (ws.inbox.length > 0
    ? Promise.resolve(ws.inbox.shift())
    : new Promise((resolve) => {
      ws.waiting.push(resolve);
    }));

  // what the receiver gets for a message, sent before a chat
  const sendThenChat = async (sender, data) => {
    count += 1;
    const probe = `ws-chat-probe-${count}`;
    const received = nextMessage(receiver);
    sender.send(JSON.stringify(data));
    sender.send(JSON.stringify({ type: 'chat', msg: probe }));

    return { got: await received, probe };
  };

  before(async function () {
    ({ port } = wsModule.server.address());
    await U.signUp(alice);
    const res = await chai.request(U.serverURL).post('/localLogin')
      .redirects(0)
      .send(alice);
    cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0])
      .find((c) => c.startsWith('connect.sid='));
    assert.isString(cookie, `login as ${alice.username}`);
    receiver = await open();
  });

  after(async function () {
    sockets.forEach((ws) => ws.terminate());
    await U.removeLocalUser(alice.username);
  });

  it("names a logged-in sender by the session's user, whatever it sent", async function () {
    const sender = await open({ Cookie: cookie });
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg: 'hi', username: 'someoneelse', randomUuid: 7 }));
    assert.deepEqual(await received, { type: 'chat', msg: 'hi', username: alice.username, randomUuid: 7 });
  }).timeout(U.shortTimeout);

  it('names a logged-out sender Anonymous, whatever it sent', async function () {
    const sender = await open();
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg: 'hello', username: alice.username, randomUuid: 'x', extra: 1 }));
    assert.deepEqual(await received, { type: 'chat', msg: 'hello', username: 'Anonymous' });
  }).timeout(U.shortTimeout);

  // the viewer turns a numeric randomUuid into an animal nickname (HippyHippo)
  it('passes a numeric randomUuid through for a logged-out sender', async function () {
    const sender = await open();
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg: 'animal', username: 'mallory', randomUuid: 1234 }));
    assert.deepEqual(await received, { type: 'chat', msg: 'animal', username: 'Anonymous', randomUuid: 1234 });
  }).timeout(U.shortTimeout);

  it('does not relay a message that is not a chat', async function () {
    const sender = await open();
    for (const data of [{ type: 'saved', project: 'p', source: 's', slice: '0' }, { type: 'other', msg: 'x' }]) {
      // eslint-disable-next-line no-await-in-loop -- one message at a time
      const { got, probe } = await sendThenChat(sender, data);
      assert.equal(got.msg, probe, `${data.type} was relayed`);
    }
  }).timeout(U.shortTimeout);

  it('drops a chat whose msg is too long or not a string', async function () {
    const sender = await open();
    const ok = await sendThenChat(sender, { type: 'chat', msg: 'x'.repeat(1000) });
    assert.lengthOf(ok.got.msg, 1000, 'a message of 1000 characters is relayed');
    await nextMessage(receiver);
    for (const msg of ['x'.repeat(1001), 42, null, { a: 1 }]) {
      // eslint-disable-next-line no-await-in-loop -- one message at a time
      const { got, probe } = await sendThenChat(sender, { type: 'chat', msg });
      assert.equal(got.msg, probe, `${JSON.stringify(msg).slice(0, 20)} was relayed`);
    }
  }).timeout(U.shortTimeout);
});
