'use strict';

const crypto = require('crypto');
const net = require('net');
const { assert } = require('chai');
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// F6 (audit 2026-10-19): the WebSocket whitelist and blacklist matched
// ip.split(':').pop(), so ::1, and any address ending in ':1', was listed as
// '1'. The peer is now matched by its whole address, with an IPv4-mapped
// address written as IPv4 (the lists are keyed by IPv4 strings), as BrainBox's
// admin check (d12ee4f). A refused peer is answered 403 and never accepted.

// a masked client text frame (payload under 126 bytes)
const textFrame = (text) => {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);

  return Buffer.concat([
    Buffer.from([0x81, 0x80 | payload.length]),
    mask,
    Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))
  ]);
};

// eslint-disable-next-line max-statements
describe('WebSocket peers are matched by their whole address (F6)', function () {
  const saved = {};
  const sockets = [];
  let port;
  let count = 0;

  // {status: 'open', ws}, or {status: 'refused <code>'}
  const connect = (host) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    sockets.push(ws);
    ws.once('open', () => resolve({ status: 'open', ws }));
    ws.once('unexpected-response', (req, res) => {
      res.resume();
      resolve({ status: `refused ${res.statusCode}` });
    });
    ws.once('error', reject);
  });

  const nextMessage = (ws) => new Promise((resolve) => {
    ws.once('message', (msg) => resolve(JSON.parse(String(msg))));
  });

  // what a receiver gets next after a sender's chat (both from hosts not on
  // the list under test)
  const relayed = async (sender, receiver) => {
    count += 1;
    const msg = `f6-${count}`;
    const received = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'chat', msg }));

    return { got: (await received).msg, msg };
  };

  before(function () {
    ({ port } = wsModule.server.address());
    for (const key of ['useWhitelist', 'useBlacklist', 'whitelist', 'blacklist']) {
      saved[key] = wsModule[key];
    }
  });

  beforeEach(function () {
    Object.assign(wsModule, { useWhitelist: false, useBlacklist: true, whitelist: {}, blacklist: {} });
  });

  afterEach(function () {
    sockets.splice(0).forEach((ws) => ws.terminate());
  });

  after(function () {
    Object.assign(wsModule, saved);
  });

  it('keeps the whole address, IPv4-mapped written as IPv4', function () {
    const peer = (remoteAddress) => wsModule.peerAddress({ socket: { remoteAddress } });
    assert.equal(peer('::1'), '::1');
    assert.equal(peer('2001:DB8::1'), '2001:db8::1');
    assert.equal(peer('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(peer('203.0.113.7'), '203.0.113.7');
    assert.isNull(peer(undefined)); // eslint-disable-line no-undefined
    assert.isNull(peer('not an address'));
  });

  it("accepts an IPv6 peer listed as '1' (its last group), and relays its chat", async function () {
    wsModule.blacklist = { 1: true };
    const sender = await connect('[::1]');
    assert.equal(sender.status, 'open');
    const receiver = await connect('127.0.0.1');
    const { got, msg } = await relayed(sender.ws, receiver.ws);
    assert.equal(got, msg);
  }).timeout(U.shortTimeout);

  it('refuses an IPv6 peer listed by its whole address', async function () {
    wsModule.blacklist = { '::1': true };
    assert.equal((await connect('[::1]')).status, 'refused 403');
    assert.equal((await connect('127.0.0.1')).status, 'open');
  }).timeout(U.shortTimeout);

  it('refuses an IPv4 peer listed as IPv4, on the dual-stack server', async function () {
    wsModule.blacklist = { '127.0.0.1': true };
    assert.equal((await connect('127.0.0.1')).status, 'refused 403');
    assert.equal((await connect('[::1]')).status, 'open');
  }).timeout(U.shortTimeout);

  it('the whitelist lets through only whole addresses', async function () {
    Object.assign(wsModule, { useWhitelist: true, useBlacklist: false, whitelist: { 1: true } });
    assert.equal((await connect('[::1]')).status, 'refused 403');
    wsModule.whitelist = { '::1': true };
    assert.equal((await connect('[::1]')).status, 'open');
    assert.equal((await connect('127.0.0.1')).status, 'refused 403');
  }).timeout(U.shortTimeout);

  it("never relays a refused peer's chat, sent with its upgrade request", async function () {
    wsModule.blacklist = { '::1': true };
    const receiver = (await connect('127.0.0.1')).ws;
    const sender = (await connect('127.0.0.1')).ws;
    let leaked = false;
    receiver.on('message', (msg) => {
      leaked = leaked || String(msg).includes('refused-peer-chat');
    });
    // the request and a chat frame in one write: the earliest a peer can send
    const answer = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '::1', () => {
        socket.write(Buffer.concat([
          Buffer.from(`GET / HTTP/1.1\r\nHost: [::1]:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`),
          textFrame(JSON.stringify({ type: 'chat', msg: 'refused-peer-chat' }))
        ]));
      });
      let text = '';
      socket.on('data', (chunk) => { text += chunk; });
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
    });
    assert.match(answer, /^HTTP\/1\.1 403/);
    // a chat sent after it arrives first: nothing came before it
    const { got, msg } = await relayed(sender, receiver);
    assert.equal(got, msg);
    assert.isFalse(leaked);
  }).timeout(U.shortTimeout);
});
