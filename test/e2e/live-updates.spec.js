/* global Microdraw */
/* eslint-disable max-lines */
'use strict';

/*
  Simultaneous editing, step 3b: the viewer joins the WebSocket room of the
  slice it shows, and again after a reconnect. After a save of that slice
  (the server's 'saved' notice, step 3a), a slice without unsaved changes is
  fetched again and shows the new state without a reload; a slice with unsaved
  changes keeps them, and is fetched once the user's own save is done.

  "Nothing arrived" is checked without waiting: a probe connection sends a
  chat, which the server relays to every other connection after anything it
  sent them before; once the page shows the chat, any notice was handled.
*/
const { assert } = require('chai');
const WebSocket = require('ws');
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

const SOURCE = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const project = U.createPublicAnnotationProject('e2eliveupdates');
// anyone: no access to the annotations; `other` edits
const privateProject = U.createProjectWithPermission('e2eliveupdatesprivate', { files: 'view' });
const other = { username: 'e2e-live-other', password: 'e2e-live-other-password' };
privateProject.owner = other.username;
privateProject.files.list = [{ source: SOURCE, name: 'cat' }];
privateProject.collaborators.list.push({
  username: other.username,
  userID: other.username,
  name: other.username,
  access: { collaborators: 'none', annotations: 'edit', files: 'view' }
});

const dataURL = (p = project, source = SOURCE, slice = 0) => U.url(`/data?source=${source}&project=${p.shortname}&slice=${slice}`);
const fileID = (slice) => `${SOURCE}&slice=${slice}`;
const room = (slice, p = project) => ({ project: p.shortname, source: SOURCE, slice: String(slice) });
const STATUS = 'Updated: saved by another user';

const region = (uid, x) => ({
  name: uid,
  uid,
  path: ['Path', { applyMatrix: true, segments: [[x, 300], [x + 100, 300], [x + 50, 400]], closed: true }]
});

let contextB;
let contextA;
let pages = [];
let agent;
let probe;
let probeCount = 0;
let problems;

const shadowclick = async (page, sel) => {
  const handle = await page.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
  await handle.click();
};

// What the browser logs as errors for resources: blocked external hosts, the
// test data's missing tiles, the annotation load refused (403, M3c). Not the
// viewer's own errors.
const BROWSER_LOGS = /^(Failed to load resource: |Tile %s failed to load: )/;

// A page with its console errors and page errors kept in `problems`, and its
// GET /api annotation loads in page.loads.
const openPage = async (context, url) => {
  const page = await context.newPage();
  pages.push(page);
  page.loads = [];
  page.infos = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !BROWSER_LOGS.test(msg.text())) { problems.push(`console: ${msg.text()}`); }
    if (msg.type() === 'info') { page.infos.push(msg.text()); }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (req.method() === 'GET' && u.pathname === '/api' && u.searchParams.get('action') === 'load_last') {
      page.loads.push(u.searchParams.get('slice'));
    }
  });
  await page.setViewport({ width: U.width, height: U.height });
  await H.openData(page, url);

  return page;
};

const go = async (page, sel, slice) => {
  await shadowclick(page, sel);
  await H.waitForMicrodraw(page, slice);
  await H.settleFrames(page);
};

// Wait until `test()` is true, checked in this process (not in a page).
const waitFor = (test, what) => {
  const deadline = Date.now() + U.shortTimeout;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (test()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`not seen: ${what()}`));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
};

const waitForRoom = (target, size) => waitFor(
  () => wsModule._roomSize(target) === size,
  () => `room ${JSON.stringify(target)} with ${size} connections (has ${wsModule._roomSize(target)})`
);

// What the other user's viewer sends (as test/api/concurrent-save.spec.js).
const otherSaves = async (slice, Regions, p = project) => {
  const res = await agent.post('/api').send({
    action: 'save',
    source: SOURCE,
    slice,
    project: p.shortname,
    Hash: 'e2elive',
    annotation: JSON.stringify({ Regions, RegionsToRemove: [] })
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

// Wait until `page` has handled every WebSocket message sent to it so far,
// and the fetch any of them started is answered.
const settle = async (page) => {
  probeCount += 1;
  const id = `e2e-live-probe-${probeCount}`;
  probe.send(JSON.stringify({ type: 'chat', msg: id, username: 'probe' }));
  await page.waitForFunction((s) => Microdraw.dom.querySelector('#logChat .text').textContent.includes(s), { polling: 50, timeout: U.shortTimeout }, id);
  await page.waitForFunction(() => window.__mdTest.pendingApiGets === 0, { polling: 50, timeout: U.shortTimeout });
  await H.settleFrames(page);
};

const uids = (page, slice) => page.evaluate((s) => Microdraw.ImageInfo[s].Regions.map((r) => r.uid).sort(), String(slice));
const drawnCount = (page) => page.evaluate(() => window.paper.project.activeLayer.children.length);
const hasRegion = (page, uid, slice = '0') => page.waitForFunction(
  (u, s) => Microdraw.currentImage === s && Microdraw.ImageInfo[s].Regions.some((r) => r.uid === u),
  { polling: 50, timeout: U.shortTimeout }, uid, slice
);
const currentUids = async (slice) => (await U.findAnnotations({ fileID: fileID(slice), project: project.shortname, backup: { $exists: false } }))
  .map((d) => d.annotation.uid)
  .sort();

// A page in the background gets no animation frames (the save dialog fades on
// them): bring the page acted on to the front.
const drawTriangle = async (page, x = 300) => {
  await page.bringToFront();
  await shadowclick(page, UI.DRAWPOLYGON);
  for (const [px, py] of [[x, 100], [x + 100, 100], [x + 50, 200], [x, 100]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.click(px, py);
  }
  await H.waitForTools(page);
};

// eslint-disable-next-line max-statements
describe('The viewer follows the saves of other users (live updates, step 3b)', () => {
  // eslint-disable-next-line max-statements
  before(async () => {
    for (const p of [project, privateProject]) {
      // eslint-disable-next-line no-await-in-loop
      await U.removeProject(p.shortname);
      // eslint-disable-next-line no-await-in-loop
      await U.insertProject(p);
    }
    agent = await U.logIn(other);
    contextB = await H.newContext();
    const p = await contextB.newPage();
    await H.logIn(p);
    await p.close();
    contextA = await H.newContext();
    const q = await contextA.newPage();
    await H.logIn(q, other);
    await q.close();
    probe = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsModule.server.address().port}`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  });

  beforeEach(async () => {
    problems = [];
    await U.removeProjectAnnotations(project.shortname);
    await U.removeProjectAnnotations(privateProject.shortname);
  });

  afterEach(async () => {
    for (const page of pages) {
      // eslint-disable-next-line no-await-in-loop
      await page.close();
    }
    pages = [];
  });

  after(async () => {
    try {
      if (probe) { probe.terminate(); }
      await H.closeContext(contextB);
      await H.closeContext(contextA);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProjectAnnotations(privateProject.shortname);
      await U.removeProject(project.shortname);
      await U.removeProject(privateProject.shortname);
      await U.removeLocalUser(other.username);
    }
  });

  // eslint-disable-next-line max-statements
  it('A saves a new region; B, on the same slice, shows it without reloading', async () => {
    const pageB = await openPage(contextB, dataURL());
    const pageA = await openPage(contextA, dataURL());
    await waitForRoom(room(0), 2);
    await pageB.evaluate(() => { window.__notReloaded = true; });

    await drawTriangle(pageA);
    const [drawn] = await uids(pageA, 0);
    await H.waitForSave(pageA, () => shadowclick(pageA, UI.SAVE));

    await hasRegion(pageB, drawn);
    assert.deepEqual(await uids(pageB, 0), [drawn]);
    assert.equal(await drawnCount(pageB), 1, 'drawn');
    assert.isTrue(await pageB.evaluate(() => window.__notReloaded === true), 'not reloaded');
    assert.isNull(await pageB.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'not changed');
    assert.equal(await pageB.evaluate(() => Microdraw.dom.querySelector('#liveStatus').textContent), STATUS);
    // A's own notice changed nothing on A
    await settle(pageA);
    assert.deepEqual(await uids(pageA, 0), [drawn]);
    assert.equal(await pageA.evaluate(() => Microdraw.dom.querySelector('#liveStatus').textContent), '');
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('B with unsaved changes keeps them when A saves; after B saves, B shows both', async () => {
    const pageB = await openPage(contextB, dataURL());
    const pageA = await openPage(contextA, dataURL());
    await waitForRoom(room(0), 2);
    await drawTriangle(pageB, 500);
    const [mine] = await uids(pageB, 0);

    await drawTriangle(pageA);
    const [theirs] = await uids(pageA, 0);
    pageB.loads = [];
    await H.waitForSave(pageA, () => shadowclick(pageA, UI.SAVE));
    await settle(pageB);
    assert.deepEqual(pageB.loads, [], 'no fetch while B has unsaved changes');
    assert.deepEqual(await uids(pageB, 0), [mine]);
    assert.isNotNull(await pageB.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'still unsaved');

    await pageB.bringToFront();
    await H.waitForSave(pageB, () => shadowclick(pageB, UI.SAVE));
    await hasRegion(pageB, theirs);
    assert.deepEqual(await uids(pageB, 0), [mine, theirs].sort());
    assert.equal(await drawnCount(pageB), 2, 'drawn');
    assert.deepEqual(await currentUids(0), [mine, theirs].sort(), 'current on the server');
    assert.isNull(await pageB.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'not changed');
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('B on another slice: no fetch', async () => {
    await otherSaves('1', [region('livey', 300)]);
    const pageB = await openPage(contextB, dataURL());
    await go(pageB, UI.NEXT, 1);
    await waitForRoom(room(1), 1);
    pageB.loads = [];

    await otherSaves('0', [region('livez', 500)]);
    await settle(pageB);
    assert.deepEqual(pageB.loads, []);
    assert.deepEqual(await uids(pageB, 1), ['livey']);
    assert.equal(await drawnCount(pageB), 1);
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);

  it('B on another image: no fetch', async () => {
    const pageB = await openPage(contextB, dataURL(project, ZARR));
    await waitForRoom({ project: project.shortname, source: ZARR, slice: '0' }, 1);
    pageB.loads = [];

    await otherSaves('0', [region('livez', 500)]);
    await settle(pageB);
    assert.deepEqual(pageB.loads, []);
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('the saver\'s own notice, arriving before its save\'s answer, fetches nothing; after the save its edit and undo steps stay', async () => {
    const pageB = await openPage(contextB, dataURL());
    await waitForRoom(room(0), 1);
    await drawTriangle(pageB);
    const [mine] = await uids(pageB, 0);
    const cookie = (await pageB.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');

    // hold B's POST /api; the test sends it to the server, so the notice comes first
    let held = null;
    let seen;
    const heldSeen = new Promise((resolve) => { seen = resolve; });
    const onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) { return; }
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api') {
        held = req;
        seen();
      } else {
        req.continue();
      }
    };
    await pageB.setRequestInterception(true);
    pageB.on('request', onRequest);
    try {
      await shadowclick(pageB, UI.SAVE);
      await heldSeen;
      const res = await agent.post('/api').set('Cookie', cookie)
        .send(JSON.parse(held.postData()));
      assert.equal(res.status, 200);
      pageB.loads = [];
      await settle(pageB);
      assert.deepEqual(pageB.loads, [], 'no fetch while the save is out');
      await held.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      await pageB.waitForFunction(() => (/Successfully saved/).test(Microdraw.dom.querySelector('#saveDialog').textContent), { polling: 50, timeout: U.mediumTimeout });
      await pageB.waitForFunction(() => window.__mdTest.pendingApiGets === 0, { polling: 50, timeout: U.shortTimeout });
    } finally {
      pageB.off('request', onRequest);
      await pageB.setRequestInterception(false);
    }
    assert.isAtMost(pageB.loads.length, 1, 'one refresh after the save at most');
    assert.deepEqual(await uids(pageB, 0), [mine]);
    assert.deepEqual(await currentUids(0), [mine]);
    assert.isAbove(await pageB.evaluate(() => Microdraw.UndoStack.filter((u) => u.imageNumber === '0').length), 0, 'undo steps kept');
    assert.equal(await pageB.evaluate(() => Microdraw.dom.querySelector('#liveStatus').textContent), '');
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('a viewer refused the join gets no updates and no errors', async () => {
    const contextC = await H.newContext();
    try {
      // logged out, on a project whose annotations anyone may not view
      const pageC = await openPage(contextC, dataURL(privateProject));
      await waitFor(() => pageC.infos.some((t) => t.includes('No live updates for this slice')), () => 'join refused');
      assert.equal(wsModule._roomSize(room(0, privateProject)), 0);
      pageC.loads = [];

      await otherSaves('0', [region('liveprivate', 300)], privateProject);
      await settle(pageC);
      assert.deepEqual(pageC.loads, []);
      assert.deepEqual(await uids(pageC, 0), []);
      assert.deepEqual(problems, []);
    } finally {
      for (const page of pages) {
        // eslint-disable-next-line no-await-in-loop
        await page.close();
      }
      pages = [];
      await H.closeContext(contextC);
    }
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('after the server drops the connection, the viewer reconnects and rejoins', async () => {
    const sockets = [];
    const onUpgrade = (req, socket) => sockets.push(socket);
    wsModule.server.on('upgrade', onUpgrade);
    let pageB;
    try {
      pageB = await openPage(contextB, dataURL());
      await waitForRoom(room(0), 1);
    } finally {
      wsModule.server.off('upgrade', onUpgrade);
    }
    assert.isAbove(sockets.length, 0);
    sockets.forEach((s) => s.destroy());
    await waitForRoom(room(0), 0);
    await waitForRoom(room(0), 1);

    await otherSaves('0', [region('livereconnect', 300)]);
    await hasRegion(pageB, 'livereconnect');
    assert.deepEqual(await uids(pageB, 0), ['livereconnect']);
    assert.deepEqual(problems, []);
  }).timeout(U.longTimeout);
});
