/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

// Simultaneous editing step 3a: a WebSocket connection joins the room of one
// image slice of a project, {type: 'join', project, source, slice}, if its
// session user (the cookie of the upgrade request, never a username in the
// message) may view the project's annotations. After a save of the slice is
// stored, the room gets {type: 'saved', project, source, slice}: no regions,
// no username. The saver's connection is not known to the save routes, so it
// gets the notice too.
//
// "Nothing arrived" is checked without waiting: after the request, a probe
// connection sends a chat, which the server relays to every other connection
// after anything the request sent them.
// eslint-disable-next-line max-statements
describe('Live-update notices over the WebSocket (step 3a)', function () {
  const sourceA = 'live-updates-source-a';
  const sourceB = 'live-updates-source-b';
  const editorA = { username: 'liveeditora', password: 'live-editor-a-password' };
  const editorB = { username: 'liveeditorb', password: 'live-editor-b-password' };
  const viewerC = { username: 'liveviewerc', password: 'live-viewer-c-password' };
  const outsiderD = { username: 'liveoutsiderd', password: 'live-outsider-d-password' };
  const member = (username, annotations) => ({
    username,
    userID: username,
    name: username,
    access: { collaborators: 'none', annotations, files: 'view' }
  });
  // anyone: no access; A and B edit, C views, D is not listed
  const privateProject = U.createProjectWithPermission('liveupdatesprivate', { files: 'view', annotations: 'edit' });
  privateProject.owner = editorA.username;
  privateProject.collaborators.list = [
    privateProject.collaborators.list[0],
    member(editorA.username, 'edit'),
    member(editorB.username, 'edit'),
    member(viewerC.username, 'view')
  ];
  // anyone may view the annotations, A edits
  const publicProject = U.createProjectWithPermission('liveupdatespublic', { files: 'view', annotations: 'edit' });
  publicProject.owner = editorA.username;
  publicProject.collaborators.list = [
    { ...publicProject.collaborators.list[0], access: { collaborators: 'none', annotations: 'view', files: 'view' } },
    member(editorA.username, 'edit')
  ];
  const at = (slice, source = sourceA, project = privateProject.shortname) => ({ project, source, slice });
  const notice = (target) => ({ type: 'saved', ...target, slice: String(target.slice) });

  const cookies = {};
  const sockets = [];
  let port;
  let probe;
  let probeCount = 0;

  const sessionCookie = async (credentials) => {
    await U.signUp(credentials);
    const res = await chai.request(U.serverURL).post('/localLogin')
      .redirects(0)
      .send(credentials);
    const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0])
      .find((c) => c.startsWith('connect.sid='));
    assert.isString(cookie, `login as ${credentials.username}`);

    return cookie;
  };

  // A connection that keeps every message it gets, in order.
  const connect = (cookie) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, cookie ? { headers: { Cookie: cookie } } : {});
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

  const join = (ws, target, extra = {}) => {
    ws.send(JSON.stringify({ type: 'join', ...target, ...extra }));

    return nextMessage(ws);
  };
  const joined = async (cookie, target) => {
    const ws = await connect(cookie);
    assert.deepEqual(await join(ws, target), { type: 'joined', ...target, slice: String(target.slice) });

    return ws;
  };

  // What each connection got before the next probe chat (other chats left out).
  const settle = (...targets) => {
    probeCount += 1;
    const id = `live-updates-probe-${probeCount}`;
    probe.send(JSON.stringify({ type: 'chat', msg: id }));

    return Promise.all(targets.map(async (ws) => {
      const got = [];
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- in order, until the probe
        const data = await nextMessage(ws);
        if (data.type === 'chat' && data.msg === id) {
          return got;
        }
        if (data.type !== 'chat') {
          got.push(data);
        }
      }
    }));
  };

  const save = (cookie, target) => {
    const request = chai.request(U.serverURL).post('/api');
    if (cookie) {
      request.set('Cookie', cookie);
    }

    return request.send({
      action: 'save',
      ...target,
      Hash: 'live',
      annotation: JSON.stringify({
        Regions: [{ name: 'r', uid: `live${probeCount}`, path: ['Path', { segments: [[0, 0], [10, 10], [20, 0]], closed: true }] }],
        RegionsToRemove: []
      })
    });
  };

  const upload = (token, action, target, body) => chai.request(U.serverURL).post('/api/upload')
    .query({ action, ...target, token })
    .attach('data', Buffer.from(body), 'annotation.json');
  const regionFile = JSON.stringify([{ annotation: { name: 'up', path: ['Path', { segments: [[0, 0], [5, 5]], closed: true }] } }]);

  const whenRoomSize = async (target, size) => {
    while (wsModule._roomSize(target) !== size) {
      // eslint-disable-next-line no-await-in-loop -- waits for the server's close event
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  };

  before(async function () {
    ({ port } = wsModule.server.address());
    await U.removeProject(privateProject.shortname);
    await U.removeProject(publicProject.shortname);
    await U.insertProject(privateProject);
    await U.insertProject(publicProject);
    for (const credentials of [editorA, editorB, viewerC, outsiderD]) {
      // eslint-disable-next-line no-await-in-loop -- one login at a time
      cookies[credentials.username] = await sessionCookie(credentials);
    }
    probe = await connect();
  });

  after(async function () {
    sockets.forEach((ws) => ws.terminate());
    await U.removeAnnotations(sourceA);
    await U.removeAnnotations(sourceB);
    await U.removeProject(privateProject.shortname);
    await U.removeProject(publicProject.shortname);
    for (const { username } of [editorA, editorB, viewerC, outsiderD]) {
      // eslint-disable-next-line no-await-in-loop -- cleanup
      await U.removeLocalUser(username);
    }
  });

  describe('joins', function () {
    it('accepts a user who may view the annotations', async function () {
      await joined(cookies[viewerC.username], at(0));
    }).timeout(U.shortTimeout);

    it('refuses a user who may not view them', async function () {
      const ws = await connect(cookies[outsiderD.username]);
      assert.deepEqual(await join(ws, at(0)), { type: 'join-refused', ...at(0), slice: '0', reason: 'forbidden' });
    }).timeout(U.shortTimeout);

    it('refuses a logged-out viewer where anyone may not view', async function () {
      const ws = await connect();
      assert.include(await join(ws, at(0)), { type: 'join-refused', reason: 'forbidden' });
    }).timeout(U.shortTimeout);

    it('accepts a logged-out viewer where anyone may view', async function () {
      await joined(null, at(0, sourceA, publicProject.shortname));
    }).timeout(U.shortTimeout);

    it('refuses an unknown project', async function () {
      const ws = await connect(cookies[editorA.username]);
      assert.include(await join(ws, at(0, sourceA, 'liveupdatesnosuchproject')), { type: 'join-refused', reason: 'not-found' });
    }).timeout(U.shortTimeout);

    it('ignores a username sent by the client: only the session user counts', async function () {
      const loggedOut = await connect();
      assert.include(await join(loggedOut, at(0), { username: editorA.username }), { type: 'join-refused' });
      const outsider = await connect(cookies[outsiderD.username]);
      assert.include(await join(outsider, at(0), { username: editorA.username }), { type: 'join-refused' });
    }).timeout(U.shortTimeout);

    it('reads the session again at each join: after a logout, the user is logged out', async function () {
      const cookie = await sessionCookie(editorB);
      const ws = await joined(cookie, at(0));
      await chai.request(U.serverURL).get('/logout')
        .set('Cookie', cookie)
        .redirects(0);
      assert.include(await join(ws, at(0)), { type: 'join-refused', reason: 'forbidden' });
      assert.equal(wsModule._roomSize(at(0)) > 0, true);
      // the refused join left the room
      const [got] = await settle(ws);
      assert.deepEqual(got, []);
      assert.equal((await save(cookies[editorA.username], at(0))).status, 200);
      assert.deepEqual((await settle(ws))[0], [], 'no notice after leaving');
    }).timeout(U.shortTimeout);

    it('ignores an invalid or oversized join', async function () {
      const ws = await connect(cookies[editorA.username]);
      ws.send(JSON.stringify({ type: 'join', project: 5, source: sourceA, slice: 0 }));
      ws.send(JSON.stringify({ type: 'join', project: privateProject.shortname, source: sourceA }));
      ws.send(JSON.stringify({ type: 'join', ...at(0), source: 'x'.repeat(5000) }));
      assert.deepEqual((await settle(ws))[0], []);
    }).timeout(U.shortTimeout);
  });

  describe('notices', function () {
    // eslint-disable-next-line max-statements
    it('a save by A notifies B on the slice, not C on another slice or image, not D refused', async function () {
      const a = await joined(cookies[editorA.username], at(0));
      const b = await joined(cookies[editorB.username], at(0));
      const cOtherSlice = await joined(cookies[viewerC.username], at(1));
      const cOtherImage = await joined(cookies[viewerC.username], at(0, sourceB));
      const cOtherProject = await joined(null, at(0, sourceA, publicProject.shortname));
      const d = await connect(cookies[outsiderD.username]);
      assert.include(await join(d, at(0)), { type: 'join-refused' });

      const res = await save(cookies[editorA.username], at(0));
      assert.equal(res.status, 200, res.text);
      const [gotA, gotB, gotC1, gotC2, gotC3, gotD] = await settle(a, b, cOtherSlice, cOtherImage, cOtherProject, d);
      assert.deepEqual(gotB, [notice(at(0))], 'B: one notice, no regions, no username');
      assert.deepEqual(gotA, [notice(at(0))], 'the saver gets it too (its connection is not known)');
      assert.deepEqual([gotC1, gotC2, gotC3, gotD], [[], [], [], []]);
    }).timeout(U.shortTimeout);

    it('rejoining moves the connection to the new room', async function () {
      const b = await joined(cookies[editorB.username], at(10));
      assert.deepEqual(await join(b, at(11)), { type: 'joined', ...at(11), slice: '11' });
      assert.equal(wsModule._roomSize(at(10)), 0);
      assert.equal((await save(cookies[editorA.username], at(10))).status, 200);
      assert.deepEqual((await settle(b))[0], []);
      assert.equal((await save(cookies[editorA.username], at(11))).status, 200);
      assert.deepEqual((await settle(b))[0], [notice(at(11))]);
    }).timeout(U.shortTimeout);

    it('drops a closed connection from its room', async function () {
      const b = await joined(cookies[editorB.username], at(20));
      const gone = await joined(cookies[viewerC.username], at(20));
      assert.equal(wsModule._roomSize(at(20)), 2);
      gone.close();
      await whenRoomSize(at(20), 1);
      assert.equal((await save(cookies[editorA.username], at(20))).status, 200);
      assert.deepEqual((await settle(b))[0], [notice(at(20))]);
    }).timeout(U.shortTimeout);

    it('a failed save (401, 403, 400, 500) sends nothing', async function () {
      const b = await joined(cookies[editorB.username], at(30));
      assert.equal((await save(null, at(30))).status, 401);
      assert.equal((await save(cookies[viewerC.username], at(30))).status, 403);
      assert.equal((await save(cookies[editorA.username], { ...at(30), project: '' })).status, 400);
      const bad = await chai.request(U.serverURL).post('/api')
        .set('Cookie', cookies[editorA.username])
        .send({ action: 'remove', ...at(30) });
      assert.equal(bad.status, 500);
      assert.deepEqual((await settle(b))[0], []);
    }).timeout(U.shortTimeout);

    it('the API upload save and append send one notice each; a refused upload none', async function () {
      const b = await joined(cookies[editorB.username], at(40));
      const { token } = (await chai.request(U.serverURL).get('/token')
        .set('Cookie', cookies[editorA.username])).body;
      assert.isNotEmpty(token);
      assert.equal((await upload(token, 'save', at(40), regionFile)).status, 200);
      assert.deepEqual((await settle(b))[0], [notice(at(40))]);
      assert.equal((await upload(token, 'append', at(40), regionFile)).status, 200);
      assert.deepEqual((await settle(b))[0], [notice(at(40))]);
      assert.equal((await upload(token, 'save', at(40), 'not json')).status, 400);
      assert.deepEqual((await settle(b))[0], []);
    }).timeout(U.shortTimeout);
  });

  describe('relaying', function () {
    it("chat still reaches the others, named by the sender's session", async function () {
      const a = await connect(cookies[editorA.username]);
      const b = await connect();
      const chat = { type: 'chat', msg: 'live hello', username: 'whoever', randomUuid: 7 };
      a.send(JSON.stringify(chat));
      assert.deepEqual(await nextMessage(b), { ...chat, username: editorA.username });
    }).timeout(U.shortTimeout);

    it('does not relay joins, or notices sent by a client', async function () {
      const a = await connect(cookies[editorA.username]);
      const b = await joined(cookies[editorB.username], at(50));
      a.send(JSON.stringify({ type: 'join', ...at(50) }));
      a.send(JSON.stringify(notice(at(50))));
      a.send(JSON.stringify({ type: 'joined', ...at(50) }));
      assert.deepEqual((await settle(b))[0], []);
    }).timeout(U.shortTimeout);
  });
});
