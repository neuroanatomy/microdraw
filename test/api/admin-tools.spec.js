/* eslint-disable max-lines, max-statements -- one test per behaviour, with its checks */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');
const { toId } = require('../../app/controller/toId');

// T002 3.6: the rest of BrainBox's admin tools. A: damaged projects (files
// removed by a save still missing, several current versions); B: one dataset
// (its document, projects, annotations; change its owner and name; remove its
// annotations, refused while it is open); C: a message to every connected
// viewer. The 401/403 of every route are in conformance.spec.js (5.1).
const access = { files: 'view', annotations: 'edit', collaborators: 'none' };
const anyone = { username: 'anyone', name: 'Any User', access };
const base = (shortname) => ({ name: shortname, shortname, url: '', owner: 'adm36-owner', collaborators: { list: [anyone] }, annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set I', display: true }] } });
const row = (i) => ({ source: `https://example.org/adm36/f${i}.json`, name: `file ${i}` });
const rows = (n) => Array.from({ length: n }, (x, i) => row(i));
const version = (shortname, list, extra = {}) => ({ ...base(shortname), files: { list }, ...extra });

const DS = 'https://example.org/adm36/dataset.json';
const DS_NEW = 'https://example.org/adm36/new-dataset.json';
const fileID = (source, slice) => `${source}&slice=${slice}`;
const region = (source, slice, project, user) => ({ fileID: fileID(source, slice), project, user, Hash: 'h', annotation: { name: 'r', path: [] } });

const shortnames = ['adm36inc', 'adm36del', 'adm36two', 'adm36ok', 'adm36ds'];

describe('Admin tools of T002 3.6: damaged projects, datasets, message', function () {
  const admin = { username: 'adm36-admin', password: 'adm36-admin-password' };
  const other = { username: 'adm36-other', password: 'adm36-other-password' };
  const newOwner = { username: 'adm36-newowner', password: 'adm36-newowner-password' };
  const tokens = {};
  let previousAdmins;
  const sockets = [];

  const login = async (user) => {
    const agent = await U.logIn(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    tokens[user.username] = token;
  };
  const get = (route, query = {}, user = admin) => chai.request(U.serverURL).get(route)
    .query({ token: tokens[user.username], ...query });
  const post = (route, body, user = admin) => chai.request(U.serverURL).post(route)
    .query({ token: tokens[user.username] })
    .send(body);
  const db = () => U.getDB();
  const versions = (shortname) => db().collection('projects')
    .find({ shortname }, { sort: { _id: 1 } })
    .toArray();
  const currentOf = async (shortname) => (await versions(shortname)).filter((v) => !v.backup);
  const logOf = (id) => db().collection('log')
    .findOne({ _id: toId(id) });

  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await Promise.all(shortnames.map((s) => U.removeProjectAnnotations(s)));
    await Promise.all([DS, DS_NEW].map((s) => U.removeAnnotations(s)));
    // restore-files records the datasets it adds back (datasets.js)
    await db().collection('datasets')
      .deleteMany({ source: /^https:\/\/example\.org\/adm36\// });
    await db().collection('log')
      .deleteMany({ $or: [{ 'value.shortname': { $in: shortnames } }, { 'value.source': { $in: [DS, DS_NEW] } }, { key: 'adminBroadcast', 'value.username': admin.username }] });
  };

  // A connection to the live-update server, with the messages it gets
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsModule.server.address().port}`);
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
  const closed = (ws) => new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
    } else {
      ws.once('close', resolve);
      ws.close();
    }
  });
  // the server's side of a close comes after the client's: wait for it
  const until = async (test) => {
    const deadline = Date.now() + U.shortTimeout;
    while (!test()) {
      if (Date.now() > deadline) {
        throw new Error('not reached in time');
      }
      // eslint-disable-next-line no-await-in-loop
      await U.delay(10);
    }
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    previousAdmins = admins.getAdmins();
    await Promise.all([admin, other, newOwner].map(login));
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await Promise.all(sockets.map(closed));
    await cleanup();
    await Promise.all([admin, other, newOwner].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await Promise.all(sockets.splice(0).map(closed));
    await cleanup();
  });

  describe('A. Damaged projects', function () {
    beforeEach(async function () {
      // versions are inserted oldest first: _id order is the save order
      const docs = [
        // an incomplete save: kept the first 200 of 250 files
        version('adm36inc', rows(250), { backup: true }),
        version('adm36inc', rows(200), { modified: '2026-10-01T10:00:00.000Z', modifiedBy: 'adm36-owner' }),
        // a deliberate removal: 3 files, then the first 2 (not a multiple of 100)
        version('adm36del', rows(3), { backup: true }),
        version('adm36del', rows(2), { modifiedBy: 'adm36-owner' }),
        // two current versions
        version('adm36two', rows(1)),
        version('adm36two', rows(2)),
        // a file added: not damaged
        version('adm36ok', rows(1), { backup: true }),
        version('adm36ok', rows(2))
      ];
      for (const doc of docs) {
        // eslint-disable-next-line no-await-in-loop
        await db().collection('projects')
          .insertOne(doc);
      }
      // annotations on a missing file of adm36inc, and on a kept one
      await U.insertAnnotations([region(row(210).source, 0, 'adm36inc', 'u1'), region(row(10).source, 0, 'adm36inc', 'u1')]);
    });

    const listed = async () => {
      const res = await get('/admin/json/projects/damaged');
      assert.equal(res.status, 200, res.text);

      return res.body.list.filter((p) => shortnames.includes(p.shortname));
    };
    const entry = async (shortname) => (await listed()).find((p) => p.shortname === shortname);

    it('lists the incomplete save first, the deliberate removal and the two current versions, not the clean project', async function () {
      const list = await listed();
      assert.sameMembers(list.map((p) => p.shortname), ['adm36inc', 'adm36del', 'adm36two']);
      assert.equal(list[0].shortname, 'adm36inc');
      const [inc] = list;
      assert.isTrue(inc.suspected);
      assert.equal(inc.missing, 50);
      assert.match(inc.version, /^[0-9a-f]{20}$/);
      assert.lengthOf(inc.events, 1);
      const [event] = inc.events;
      assert.deepInclude(event, { before: 250, after: 200, removed: 50, stillMissing: 50, annotated: 1, incomplete: true, modified: '2026-10-01T10:00:00.000Z', modifiedBy: 'adm36-owner' });
      assert.deepEqual(event.examples, [row(200).source, row(201).source, row(202).source]);
      const del = list.find((p) => p.shortname === 'adm36del');
      assert.isFalse(del.suspected);
      assert.deepInclude(del.events[0], { before: 3, after: 2, stillMissing: 1, incomplete: false, annotated: 0 });
      const two = list.find((p) => p.shortname === 'adm36two');
      assert.lengthOf(two.currentVersions, 2);
      assert.lengthOf(two.events, 0);
    }).timeout(U.shortTimeout);

    it('restore-files adds back the incomplete save\'s files at the end, with their names, as a new version; A2\'s restore undoes it', async function () {
      const inc = await entry('adm36inc');
      const res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version, save: inc.events[0].save });
      assert.equal(res.status, 200, res.text);
      assert.deepInclude(res.body, { restored: 50, files: 250 });
      const all = await versions('adm36inc');
      assert.lengthOf(all, 3, 'a new version');
      const currents = all.filter((v) => !v.backup);
      assert.lengthOf(currents, 1);
      assert.deepEqual(currents[0].files.list, rows(250));
      assert.equal(currents[0].modifiedBy, admin.username);
      const log = await logOf(res.body.log);
      assert.equal(log.key, 'adminRestoreProjectFiles');
      assert.deepInclude(log.value, { username: admin.username, shortname: 'adm36inc', save: inc.events[0].save, before: inc.version, after: res.body.version });
      assert.lengthOf(log.value.files, 50);
      assert.lengthOf(log.value.project.files.list, 200, 'the previous document');
      assert.isUndefined(await entry('adm36inc'), 'no longer damaged');

      const undo = await post('/admin/json/projects/restore', { log: res.body.log });
      assert.equal(undo.status, 200, undo.text);
      assert.deepEqual((await currentOf('adm36inc'))[0].files.list, rows(200));
    }).timeout(U.mediumTimeout);

    it('restore-files refuses a project changed since the list, an unknown save, and bad input', async function () {
      const inc = await entry('adm36inc');
      const [{ save }] = inc.events;
      let res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: 'stale', save });
      assert.equal(res.status, 409);
      res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version, save: '0123456789abcdef01234567' });
      assert.equal(res.status, 404);
      res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version, save: 'nope' });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/restore-files', { version: inc.version, save });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version, save }, other);
      assert.equal(res.status, 403);
      assert.lengthOf(await versions('adm36inc'), 2, 'nothing stored');
    }).timeout(U.shortTimeout);

    it('fix-current keeps the newest of two current versions and logs the others\' ids', async function () {
      const two = await entry('adm36two');
      let res = await post('/admin/json/projects/fix-current', { project: 'adm36two', version: 'stale' });
      assert.equal(res.status, 409);
      res = await post('/admin/json/projects/fix-current', { project: 'adm36two' });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/fix-current', { project: 'adm36two', version: two.version }, other);
      assert.equal(res.status, 403);

      res = await post('/admin/json/projects/fix-current', { project: 'adm36two', version: two.version });
      assert.equal(res.status, 200, res.text);
      const all = await versions('adm36two');
      assert.lengthOf(all, 2, 'no version added');
      const currents = all.filter((v) => !v.backup);
      assert.lengthOf(currents, 1);
      assert.equal(String(currents[0]._id), String(all[1]._id), 'the newest');
      assert.deepInclude(res.body, { kept: String(all[1]._id), backups: 1 });
      const log = await logOf(res.body.log);
      assert.equal(log.key, 'adminFixCurrentVersions');
      assert.deepEqual(log.value.backups, [String(all[0]._id)]);
      assert.isUndefined(await entry('adm36two'));

      res = await post('/admin/json/projects/fix-current', { project: 'adm36two', version: two.version });
      assert.equal(res.status, 409, 'one current version now');
    }).timeout(U.shortTimeout);

    it('restore-files is refused while the project has two current versions', async function () {
      await db().collection('projects')
        .insertOne(version('adm36inc', rows(200)));
      const inc = await entry('adm36inc');
      const res = await post('/admin/json/projects/restore-files', { project: 'adm36inc', version: inc.version, save: inc.events[0].save });
      assert.equal(res.status, 409);
      assert.include(res.body.error, 'current versions');
    }).timeout(U.shortTimeout);
  });

  describe('B. Datasets', function () {
    beforeEach(async function () {
      const project = version('adm36ds', [{ source: DS, name: 'brain' }]);
      await U.insertProject(project);
      await db().collection('datasets')
        .insertOne({ source: DS, name: 'slideFiles', owner: 'wwlOath', included: '2026-10-20T00:00:00.000Z' });
      await U.insertAnnotations([
        region(DS, 0, 'adm36ds', 'u1'),
        region(DS, 0, 'adm36ds', 'u1'),
        region(DS, 3, 'adm36ds', 'u1'),
        region(DS, 1, 'adm36ds', 'u2'),
        { ...region(DS, 1, 'adm36ds', 'u2'), backup: true },
        region(DS, 2, 'adm36gone', 'u3')
      ]);
    });

    it('finds a dataset: its document, the projects listing it with their row\'s name, its annotations per project and user', async function () {
      const res = await get('/admin/json/dataset', { source: DS });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.document, { name: 'slideFiles', owner: 'wwlOath', included: '2026-10-20T00:00:00.000Z' });
      assert.deepEqual(res.body.projects, [{ shortname: 'adm36ds', name: 'adm36ds', owner: 'adm36-owner', row: 'brain' }]);
      assert.deepEqual(res.body.annotations, [
        { project: 'adm36ds', user: 'u1', regions: 3, slices: 2 },
        { project: 'adm36ds', user: 'u2', regions: 1, slices: 1 },
        { project: 'adm36gone', user: 'u3', regions: 1, slices: 1 }
      ]);
      assert.equal(res.body.viewers, 0);

      const none = await get('/admin/json/dataset', { source: DS_NEW });
      assert.equal(none.status, 200);
      assert.isNull(none.body.document);
      assert.deepEqual(none.body.projects, []);
      assert.equal((await get('/admin/json/dataset')).status, 400);
      assert.equal((await get('/admin/json/dataset', { source: DS }, other)).status, 403);
    }).timeout(U.shortTimeout);

    it('update sets the owner and the name, logged with the old values', async function () {
      const res = await post('/admin/json/dataset/update', { source: DS, owner: newOwner.username, name: 'BigBrain' });
      assert.equal(res.status, 200, res.text);
      assert.deepInclude(res.body, { created: false });
      const doc = await db().collection('datasets')
        .findOne({ source: DS });
      assert.deepInclude(doc, { owner: newOwner.username, name: 'BigBrain', included: '2026-10-20T00:00:00.000Z' });
      const log = await logOf(res.body.log);
      assert.equal(log.key, 'adminUpdateDataset');
      assert.deepEqual(log.value.before, { name: 'slideFiles', owner: 'wwlOath' });
      assert.deepEqual(log.value.after, { name: 'BigBrain', owner: newOwner.username });

      const nameOnly = await post('/admin/json/dataset/update', { source: DS, name: 'Big Brain' });
      assert.equal(nameOnly.status, 200, nameOnly.text);
      assert.deepEqual(nameOnly.body.document.owner, newOwner.username);
    }).timeout(U.shortTimeout);

    it('update creates a missing document, which needs an owner; refuses bad input', async function () {
      let res = await post('/admin/json/dataset/update', { source: DS_NEW, name: 'new' });
      assert.equal(res.status, 400);
      res = await post('/admin/json/dataset/update', { source: DS_NEW, owner: newOwner.username });
      assert.equal(res.status, 200, res.text);
      assert.isTrue(res.body.created);
      assert.deepInclude(res.body.document, { owner: newOwner.username, name: 'new-dataset' });
      assert.isNull((await logOf(res.body.log)).value.before);

      for (const body of [
        { source: DS, owner: 'adm36-nosuchuser' },
        { source: DS },
        { source: DS, owner: '' },
        { source: DS, name: '  ' },
        { source: DS, name: 'x'.repeat(201) },
        { source: '/test_data/cat.json', owner: newOwner.username },
        { owner: newOwner.username }
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const bad = await post('/admin/json/dataset/update', body);
        assert.equal(bad.status, 400, JSON.stringify(body));
      }
      assert.equal((await post('/admin/json/dataset/update', { source: DS, name: 'x' }, other)).status, 403);
      assert.equal((await db().collection('datasets')
        .findOne({ source: DS })).owner, 'wwlOath');
    }).timeout(U.shortTimeout);

    it('remove-annotations marks a user\'s annotations in a project backup, logs their ids; restore-annotations undoes it', async function () {
      const res = await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds', user: 'u1' });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.removed, 3);
      assert.lengthOf(await U.findAnnotations({ project: 'adm36ds', user: 'u1' }), 0);
      assert.lengthOf(await U.findAnnotations({ project: 'adm36ds', user: 'u2' }), 1, 'other users kept');
      const log = await logOf(res.body.log);
      assert.equal(log.key, 'adminRemoveDatasetAnnotations');
      assert.lengthOf(log.value.ids, 3);

      const undo = await post('/admin/json/dataset/restore-annotations', { log: res.body.log });
      assert.equal(undo.status, 200, undo.text);
      assert.equal(undo.body.restored, 3);
      assert.lengthOf(await U.findAnnotations({ project: 'adm36ds', user: 'u1' }), 3);
      assert.equal((await post('/admin/json/dataset/restore-annotations', { log: res.body.log })).status, 409, 'current again');

      const all = await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds' });
      assert.equal(all.body.removed, 4, 'every user, without user');
    }).timeout(U.shortTimeout);

    it('remove-annotations refuses bad input and nothing to remove', async function () {
      for (const body of [{ source: DS }, { project: 'adm36ds' }, { source: DS, project: 'adm36ds', user: 3 }]) {
        // eslint-disable-next-line no-await-in-loop
        assert.equal((await post('/admin/json/dataset/remove-annotations', body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds', user: 'nobody' })).status, 404);
      assert.equal((await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds' }, other)).status, 403);
      assert.equal((await post('/admin/json/dataset/restore-annotations', {})).status, 400);
      assert.lengthOf(await U.findAnnotations({ project: 'adm36ds' }), 4);
    }).timeout(U.shortTimeout);

    it('remove-annotations is refused (409) while a viewer has the dataset open', async function () {
      // anyone may view adm36ds's annotations: a logged-out connection joins
      const ws = await connect();
      const target = { project: 'adm36ds', source: DS, slice: '3' };
      ws.send(JSON.stringify({ type: 'join', ...target }));
      assert.deepEqual(await nextMessage(ws), { type: 'joined', ...target });
      assert.equal((await get('/admin/json/dataset', { source: DS })).body.viewers, 1);

      const res = await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds', user: 'u1' });
      assert.equal(res.status, 409);
      assert.lengthOf(await U.findAnnotations({ project: 'adm36ds', user: 'u1' }), 3, 'nothing removed');

      await closed(ws);
      await until(() => wsModule.viewersOfSource(DS) === 0);
      const later = await post('/admin/json/dataset/remove-annotations', { source: DS, project: 'adm36ds', user: 'u1' });
      assert.equal(later.status, 200, later.text);
    }).timeout(U.shortTimeout);
  });

  describe('C. Message to everyone connected', function () {
    it('reaches every connected viewer, answers how many, and is logged', async function () {
      const [a, b] = [await connect(), await connect()];
      const message = 'Restart at 18:00 <b>sharp</b>';
      const res = await post('/admin/json/broadcast', { message });
      assert.equal(res.status, 200, res.text);
      assert.isAtLeast(res.body.viewers, 2);
      assert.equal(res.body.viewers, wsModule.connectedViewers());
      assert.deepEqual(await nextMessage(a), { type: 'notice', msg: message });
      assert.deepEqual(await nextMessage(b), { type: 'notice', msg: message });
      const log = await db().collection('log')
        .findOne({ key: 'adminBroadcast', 'value.username': admin.username });
      assert.deepEqual(log.value, { username: admin.username, message, viewers: res.body.viewers });

      // one viewer fewer: one fewer reached
      const before = res.body.viewers;
      await closed(b);
      await until(() => wsModule.connectedViewers() === before - 1);
      const again = await post('/admin/json/broadcast', { message: 'again' });
      assert.equal(again.body.viewers, before - 1);
      assert.deepEqual(await nextMessage(a), { type: 'notice', msg: 'again' });
    }).timeout(U.shortTimeout);

    it('refuses an empty, too long or missing message, and non-admins', async function () {
      for (const body of [{}, { message: '' }, { message: '   ' }, { message: 'x'.repeat(501) }, { message: 3 }]) {
        // eslint-disable-next-line no-await-in-loop
        assert.equal((await post('/admin/json/broadcast', body)).status, 400, JSON.stringify(body).slice(0, 40));
      }
      assert.equal((await post('/admin/json/broadcast', { message: 'x'.repeat(500) })).status, 200);
      assert.equal((await post('/admin/json/broadcast', { message: 'hi' }, other)).status, 403);
    }).timeout(U.shortTimeout);
  });
});
