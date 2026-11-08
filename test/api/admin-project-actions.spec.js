/* eslint-disable max-lines, max-statements -- one test per behaviour, with its checks */
'use strict';

const _ = require('lodash');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { ObjectId } = require('neuroweblab');
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const lock = require('../../app/controller/projectLock');
const projectActions = require('../../app/controller/admin/admin.projectActions');
const { findDeleteEntry } = require('../../app/controller/project/project.delete');

// A3: admin actions on any project (decisions D31): search, delete (as the
// owner's delete, M3b/D28: annotations marked backup, project logged), restore
// a deleted project with exactly the annotations the delete marked, transfer
// the ownership to an existing user (undone by A2's restore). Lock, version
// token (409), log, admins only.
const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });
const anyone = { username: 'anyone', access: access('view', 'view', 'view') };
const img = 'a3-histo.dzi';
const fileID = `${img}&slice=0`;

// Shaped like production's HistoPath: its owner no longer exists, the first
// annotation layer has values but no name
const histoPath = () => ({
  name: 'A3 Histo Path',
  shortname: 'a3histopath',
  description: 'like HistoPath',
  url: '',
  owner: 'a3-voyageour',
  collaborators: { list: [anyone] },
  files: { list: [{ source: img, name: 'histo' }] },
  annotations: {
    list: [
      { type: 'vectorial', name: '', values: 'Set 1', display: true },
      { type: 'vectorial', name: 'Layer 1', values: '', display: true }
    ]
  }
});
// owned by a user who exists
const owned = () => ({
  name: 'A3 owned',
  shortname: 'a3owned',
  url: '',
  owner: 'a3-owner',
  collaborators: { list: [anyone] },
  files: { list: [{ source: img, name: 'histo' }] },
  annotations: { list: [{ type: 'vectorial', name: 'cortex', values: '', display: true }] }
});
// cannot be saved again (no 'anyone' entry), but its ownership can move
const noAnyone = () => ({
  name: 'A3 no anyone',
  shortname: 'a3noanyone',
  url: '',
  owner: 'a3-voyageour',
  collaborators: { list: [{ username: 'a3-voyageour', access: access('remove', 'remove', 'remove') }] },
  files: { list: [] },
  annotations: { list: [] }
});
const fixtures = () => [histoPath(), owned(), noAnyone()];
const shortnames = fixtures().map((p) => p.shortname);

const region = (project, n, extra = {}) => ({
  fileID,
  user: 'a3-voyageour',
  project,
  Hash: `a3hash${n}`,
  annotation: { name: `region ${n}`, path: ['Path', { segments: [[n, n], [n + 10, n], [n, n + 10]], closed: true }] },
  ...extra
});

describe('Admin: delete a project, transfer ownership (A3)', function () {
  const admin = { username: 'a3-admin', password: 'a3-admin-password' };
  const other = { username: 'a3-other', password: 'a3-other-password' };
  const owner = { username: 'a3-owner', password: 'a3-owner-password' };
  const tokens = {};
  const agents = {};
  let previousAdmins;

  const login = async (user) => {
    await U.signUp(user);
    const agent = chai.request.agent(U.getServer());
    await agent.post('/localLogin').redirects(0)
      .send(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    agents[user.username] = agent;
    tokens[user.username] = token;
  };

  const get = (route, query, user = admin) => chai.request(U.serverURL).get(route)
    .query({ ...query, token: tokens[user.username] });
  const post = (route, body, user = admin) => chai.request(U.serverURL).post(route)
    .query({ token: tokens[user.username] })
    .send(body);
  const db = () => U.getDB();
  const stored = (shortname) => db().collection('projects')
    .findOne({ shortname });
  const annotationsOf = (shortname) => db().collection('annotations')
    .find({ project: shortname }, { sort: { _id: 1 } })
    .toArray();
  const logs = (shortname) => db().collection('log')
    .find({ key: /^admin/, 'value.shortname': shortname })
    .toArray();

  const search = async (q) => {
    const res = await get('/admin/json/projects/search', { q });
    assert.equal(res.status, 200, res.text);

    return res.body.list.filter((p) => shortnames.includes(p.shortname));
  };
  const found = async (shortname) => (await search(shortname)).find((p) => p.shortname === shortname);

  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await Promise.all(shortnames.map((s) => U.removeProjectAnnotations(s)));
    await db().collection('log')
      .deleteMany({ 'value.shortname': { $in: shortnames } });
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    previousAdmins = admins.getAdmins();
    await Promise.all([admin, other, owner].map(login));
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await cleanup();
    await Promise.all([admin, other, owner].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await cleanup();
    await U.insertProject(fixtures());
    await U.insertAnnotations([
      region('a3histopath', 1),
      region('a3histopath', 2),
      region('a3histopath', 3),
      region('a3histopath', 4, { backup: true }),
      region('a3owned', 5)
    ]);
  });

  describe('Access', function () {
    const jsonRoutes = [
      ['get', '/admin/json/projects/search'],
      ['post', '/admin/json/projects/delete'],
      ['post', '/admin/json/projects/restore-deleted'],
      ['post', '/admin/json/projects/transfer']
    ];

    it('refuses the routes to anonymous visitors (401) and to non-admins (403)', async function () {
      for (const [method, route] of jsonRoutes) {
        /* eslint-disable no-await-in-loop */
        const anonymous = await chai.request(U.serverURL)[method](route);
        assert.equal(anonymous.status, 401, `${method} ${route} anonymous`);
        const byToken = await chai.request(U.serverURL)[method](route)
          .query({ token: tokens[other.username] });
        assert.equal(byToken.status, 403, `${method} ${route} non-admin, token`);
        const bySession = await agents[other.username][method](route);
        assert.equal(bySession.status, 403, `${method} ${route} non-admin, session`);
        /* eslint-enable no-await-in-loop */
      }
    }).timeout(U.mediumTimeout);

    it('a non-admin owner cannot use the admin delete or transfer on his own project', async function () {
      const { version } = await found('a3owned');
      let res = await post('/admin/json/projects/delete', { project: 'a3owned', version }, owner);
      assert.equal(res.status, 403);
      res = await post('/admin/json/projects/transfer', { project: 'a3owned', version, owner: other.username }, owner);
      assert.equal(res.status, 403);
      assert.equal((await stored('a3owned')).owner, owner.username);
    }).timeout(U.shortTimeout);
  });

  describe('GET /admin/json/projects/search', function () {
    it('finds a project by shortname or by name, ignoring case, with what the actions need', async function () {
      const p = await found('a3histopath');
      assert.deepEqual(p, {
        shortname: 'a3histopath',
        name: 'A3 Histo Path',
        owner: 'a3-voyageour',
        ownerExists: false,
        version: p.version,
        counts: { files: 1, collaborators: 1, layers: 2, annotations: 3 }
      });
      assert.match(p.version, /^[0-9a-f]{20}$/);
      assert.sameMembers((await search('a3 HISTO')).map((q) => q.shortname), ['a3histopath']);
      const o = await found('a3owned');
      assert.isTrue(o.ownerExists);
      assert.equal(o.counts.annotations, 1);
    }).timeout(U.shortTimeout);

    it('the version is the one the A2 fixes use (same token)', async function () {
      const { version } = await found('a3histopath');
      const invalid = await get('/admin/json/projects/invalid');
      const listed = invalid.body.list.find((p) => p.shortname === 'a3histopath');
      assert.equal(listed.version, version);
    }).timeout(U.shortTimeout);

    it('matches the text literally (escaped), and refuses a q that is not a string', async function () {
      assert.lengthOf(await search('a3.*path'), 0);
      let res = await get('/admin/json/projects/search', { q: '(' });
      assert.equal(res.status, 200);
      res = await get('/admin/json/projects/search', { q: '(a+)+$' });
      assert.equal(res.status, 200);
      res = await get('/admin/json/projects/search', {});
      assert.equal(res.status, 400);
      res = await chai.request(U.serverURL).get(`/admin/json/projects/search?token=${tokens[admin.username]}&q[$ne]=x`);
      assert.equal(res.status, 400);
      res = await get('/admin/json/projects/search', { q: '  ' });
      assert.equal(res.status, 400);
    }).timeout(U.shortTimeout);
  });

  describe('POST /admin/json/projects/delete', function () {
    it('deletes as the owner\'s delete does: annotations marked backup, project logged with the admin', async function () {
      const { version } = await found('a3histopath');
      const res = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.annotations, 3);
      assert.isString(res.body.log);
      assert.isNull(await stored('a3histopath'));

      assert.lengthOf(await U.findAnnotations({ project: 'a3histopath' }), 0);
      const marked = await db().collection('annotations')
        .find({ project: 'a3histopath', deletedWithProject: res.body.log })
        .toArray();
      assert.lengthOf(marked, 3, 'the three current documents, not the older backup');
      marked.forEach((doc) => assert.isTrue(doc.backup));
      assert.lengthOf(await U.findAnnotations({ project: 'a3owned' }), 1, 'other projects are not touched');

      const [entry] = await logs('a3histopath');
      assert.equal(entry.key, 'adminDeleteProject');
      assert.equal(String(entry._id), res.body.log);
      assert.equal(entry.value.username, admin.username);
      assert.equal(entry.value.annotations, 3);
      assert.deepInclude(entry.value.project, { name: 'A3 Histo Path', owner: 'a3-voyageour' });
    }).timeout(U.shortTimeout);

    it('refuses a changed project (409), a missing one (404), and a body without version (400)', async function () {
      const { version } = await found('a3histopath');
      await db().collection('projects')
        .updateOne({ shortname: 'a3histopath' }, { $set: { description: 'changed meanwhile' } });
      let res = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(res.status, 409);
      assert.isNotNull(await stored('a3histopath'));
      assert.lengthOf(await U.findAnnotations({ project: 'a3histopath' }), 3);
      res = await post('/admin/json/projects/delete', { project: 'a3nosuchproject', version });
      assert.equal(res.status, 404);
      res = await post('/admin/json/projects/delete', { project: 'a3histopath' });
      assert.equal(res.status, 400);
      assert.lengthOf(await logs('a3histopath'), 0);
    }).timeout(U.shortTimeout);

    it('waits for the project lock', async function () {
      const { version } = await found('a3histopath');
      let release;
      const held = lock.withProjectLock('a3histopath', () => new Promise((resolve) => { release = resolve; }));
      const action = post('/admin/json/projects/delete', { project: 'a3histopath', version });
      const settled = await Promise.race([
        action.then(() => 'settled'),
        new Promise((resolve) => { setTimeout(() => resolve('pending'), 300); })
      ]);
      assert.equal(settled, 'pending');
      assert.isNotNull(await stored('a3histopath'));
      release();
      await held;
      assert.equal((await action).status, 200);
    }).timeout(U.shortTimeout);
  });

  describe('POST /admin/json/projects/restore-deleted', function () {
    it('brings back the project document and exactly the annotations the delete marked', async function () {
      const project = await stored('a3histopath');
      const annotations = await annotationsOf('a3histopath');
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(deleted.status, 200);

      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.annotations, 3);
      assert.deepEqual(await stored('a3histopath'), project);
      assert.deepEqual(await annotationsOf('a3histopath'), annotations, 'the older backup stays a backup');
      assert.equal(res.body.version, version);
      const restoreLog = (await logs('a3histopath')).find((l) => l.key === 'adminRestoreDeletedProject');
      assert.equal(restoreLog.value.restored, deleted.body.log);
      assert.equal(restoreLog.value.username, admin.username);

      const again = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(again.status, 409, 'restored already');
    }).timeout(U.shortTimeout);

    it('also undoes an owner\'s delete (M3b)', async function () {
      const project = await stored('a3owned');
      const annotations = await annotationsOf('a3owned');
      const deleted = await agents[owner.username].delete('/project/json/a3owned');
      assert.equal(deleted.status, 200, deleted.text);
      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await stored('a3owned'), project);
      assert.deepEqual(await annotationsOf('a3owned'), annotations);
    }).timeout(U.shortTimeout);

    it('refuses (409) when a project with that shortname exists again, and changes nothing', async function () {
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      await U.insertProject({ ...histoPath(), name: 'a new one' });
      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 409);
      assert.lengthOf(await db().collection('projects')
        .find({ shortname: 'a3histopath' })
        .toArray(), 1);
      assert.lengthOf(await U.findAnnotations({ project: 'a3histopath' }), 0);
    }).timeout(U.shortTimeout);

    it('answers 400 without a log id, 404 for an unknown one or one that is not a delete', async function () {
      let res = await post('/admin/json/projects/restore-deleted', {});
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/restore-deleted', { log: '0123456789abcdef01234567' });
      assert.equal(res.status, 404);
      res = await post('/admin/json/projects/restore-deleted', { log: 'not-an-id' });
      assert.equal(res.status, 404);
      const { version } = await found('a3histopath');
      const transferred = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      res = await post('/admin/json/projects/restore-deleted', { log: transferred.body.log });
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('POST /admin/json/projects/transfer', function () {
    it('gives a project whose owner does not exist to an existing user, who can then edit its settings', async function () {
      const before = await stored('a3histopath');
      const { version } = await found('a3histopath');
      const res = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.owner, owner.username);
      assert.equal(res.body.previousOwner, 'a3-voyageour');
      assert.isString(res.body.log);
      assert.notEqual(res.body.version, version);

      const after = await stored('a3histopath');
      assert.equal(after.owner, owner.username);
      assert.deepEqual({ ...after, owner: before.owner }, before, 'nothing else changed');
      const [entry] = await logs('a3histopath');
      assert.equal(entry.key, 'adminTransferOwner');
      assert.deepInclude(entry.value, { username: admin.username, from: 'a3-voyageour', to: owner.username });
      assert.equal(entry.value.project.owner, 'a3-voyageour');
      assert.isTrue((await found('a3histopath')).ownerExists);

      const data = { ...histoPath(), name: 'renamed by the new owner' };
      const save = await agents[owner.username].post('/project/json/a3histopath')
        .send({ data });
      assert.equal(save.status, 200, save.text);
      assert.equal((await stored('a3histopath')).name, 'renamed by the new owner');
    }).timeout(U.shortTimeout);

    it('the previous owner, if he exists, loses the owner\'s rights', async function () {
      const { version } = await found('a3owned');
      const res = await post('/admin/json/projects/transfer', { project: 'a3owned', version, owner: other.username });
      assert.equal(res.status, 200, res.text);
      const save = await agents[owner.username].post('/project/json/a3owned')
        .send({ data: { ...owned(), name: 'renamed by the old owner' } });
      assert.equal(save.status, 403);
      const remove = await agents[owner.username].delete('/project/json/a3owned');
      assert.equal(remove.status, 403);
      const byNewOwner = await agents[other.username].post('/project/json/a3owned')
        .send({ data: { ...owned(), name: 'renamed by the new owner' } });
      assert.equal(byNewOwner.status, 200, byNewOwner.text);
      assert.equal((await stored('a3owned')).owner, other.username, 'a save keeps the owner');
    }).timeout(U.shortTimeout);

    it('refuses a user that does not exist, the current owner, or no owner (400)', async function () {
      const { version } = await found('a3histopath');
      for (const to of ['a3-nobody', 'a3-voyageour', '', null, ['a3-owner']]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: to });
        assert.equal(res.status, 400, JSON.stringify(to));
      }
      assert.equal((await stored('a3histopath')).owner, 'a3-voyageour');
      assert.lengthOf(await logs('a3histopath'), 0);
    }).timeout(U.shortTimeout);

    it('refuses a changed project (409) and a missing one (404)', async function () {
      const { version } = await found('a3histopath');
      await db().collection('projects')
        .updateOne({ shortname: 'a3histopath' }, { $set: { name: 'renamed meanwhile' } });
      let res = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      assert.equal(res.status, 409);
      assert.equal((await stored('a3histopath')).owner, 'a3-voyageour');
      res = await post('/admin/json/projects/transfer', { project: 'a3nosuchproject', version, owner: owner.username });
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);

    it('changes only the owner, also of a project that would not validate', async function () {
      const before = await stored('a3noanyone');
      const { version } = await found('a3noanyone');
      const res = await post('/admin/json/projects/transfer', { project: 'a3noanyone', version, owner: owner.username });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual({ ...(await stored('a3noanyone')), owner: before.owner }, before);
    }).timeout(U.shortTimeout);

    it('is undone by A2\'s restore, once', async function () {
      const before = await stored('a3histopath');
      const { version } = await found('a3histopath');
      const transferred = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      let res = await post('/admin/json/projects/restore', { log: transferred.body.log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await stored('a3histopath'), before);
      res = await post('/admin/json/projects/restore', { log: transferred.body.log });
      assert.equal(res.status, 409);
    }).timeout(U.shortTimeout);

    // What the transfer and its restore leave stored
    it('keeps the project\'s ObjectId and a string owner through the transfer and its restore, and logs both versions', async function () {
      const nativeDoc = () => U.getNativeDB().collection('projects')
        .findOne({ shortname: 'a3histopath', backup: { $exists: false } });
      const assertStored = (doc, ownerName, expected) => {
        assert.instanceOf(doc._id, ObjectId);
        assert.equal(String(doc._id), String(expected._id));
        assert.isString(doc.owner);
        assert.equal(doc.owner, ownerName);
        assert.deepEqual(_.omit(doc, ['_id', 'owner']), _.omit(expected, ['_id', 'owner']));
      };
      const before = await nativeDoc();
      const { version } = await found('a3histopath');
      const transferred = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      assert.equal(transferred.status, 200, transferred.text);
      assertStored(await nativeDoc(), owner.username, before);

      const logged = await U.getNativeDB().collection('log')
        .findOne({ _id: new ObjectId(transferred.body.log) });
      assert.instanceOf(logged._id, ObjectId);
      assert.deepEqual(Object.keys(logged), ['_id', 'key', 'value', 'date']);
      assert.deepEqual(Object.keys(logged.value), ['username', 'shortname', 'before', 'from', 'to', 'project', 'after']);
      assert.deepEqual(_.omit(logged.value, ['project']), {
        username: admin.username,
        shortname: 'a3histopath',
        before: version,
        from: 'a3-voyageour',
        to: owner.username,
        after: transferred.body.version
      });
      assert.deepEqual(logged.value.project, _.omit(before, ['_id']));

      const restored = await post('/admin/json/projects/restore', { log: transferred.body.log });
      assert.equal(restored.status, 200, restored.text);
      assert.equal(restored.body.version, version);
      assertStored(await nativeDoc(), 'a3-voyageour', before);
    }).timeout(U.shortTimeout);

    // The search lists a version, the transfer checks it on its own read: the
    // same token whatever the stored types
    it('accepts the version searched, whatever the stored types, and keeps them', async function () {
      const held = new ObjectId('0123456789abcdef01234567');
      await db().collection('projects')
        .updateOne(
          { shortname: 'a3histopath' },
          { $set: { date: new Date(0), ref: held, numbers: [1, 1.5, null, 2 ** 40] } }
        );
      const { version } = await found('a3histopath');
      const res = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      assert.equal(res.status, 200, res.text);
      const after = await U.getNativeDB().collection('projects')
        .findOne({ shortname: 'a3histopath' });
      assert.instanceOf(after.ref, ObjectId);
      assert.equal(String(after.ref), String(held));
      assert.instanceOf(after.date, Date);
      assert.deepEqual(after.numbers, [1, 1.5, null, 2 ** 40]);
      const undo = await post('/admin/json/projects/restore', { log: res.body.log });
      assert.equal(undo.status, 200, undo.text);
      assert.equal(undo.body.version, version);
      assert.instanceOf((await U.getNativeDB().collection('projects')
        .findOne({ shortname: 'a3histopath' })).ref, ObjectId);
    }).timeout(U.shortTimeout);

    it('waits for the project lock', async function () {
      const { version } = await found('a3histopath');
      let release;
      const held = lock.withProjectLock('a3histopath', () => new Promise((resolve) => { release = resolve; }));
      const action = post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      const settled = await Promise.race([
        action.then(() => 'settled'),
        new Promise((resolve) => { setTimeout(() => resolve('pending'), 300); })
      ]);
      assert.equal(settled, 'pending');
      release();
      await held;
      assert.equal((await action).status, 200);
    }).timeout(U.shortTimeout);
  });

  // What the deletes and restores leave in the database, read through the
  // native driver: the `log` entries, the annotations' marks, the project's
  // _id (the same ObjectId after a restore).
  describe('What ends in the database', function () {
    const native = () => U.getNativeDB();
    const doc = (shortname) => native().collection('projects')
      .findOne({ shortname, backup: { $exists: false } });
    const logEntry = (id) => native().collection('log')
      .findOne({ _id: new ObjectId(id) });
    const allAnnotations = (shortname) => native().collection('annotations')
      .find({ project: shortname })
      .sort({ _id: 1 })
      .toArray();
    const isoDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
    // what restoreDeleted and transferProject need of NWL's database
    const appDb = { nativeMongoDB: () => U.getNativeDB() };
    const reset = async () => {
      await cleanup();
      await U.insertProject(fixtures());
      await U.insertAnnotations([region('a3owned', 5), region('a3owned', 6, { backup: true }), region('a3owned', 7)]);
    };
    // What the delete of 3cd20a4 (before step 6) stored: production's
    // existing delete logs were written this way
    const oldDelete = async (shortname, username) => {
      const project = await native().collection('projects')
        .findOne({ shortname, backup: { $exists: false } });
      const annotations = { project: shortname, backup: { $exists: false } };
      const entry = {
        key: 'deleteProject',
        value: {
          username,
          shortname,
          projectId: project._id,
          project: _.omit(project, ['_id']),
          annotations: await native().collection('annotations')
            .countDocuments(annotations)
        },
        date: (new Date()).toJSON()
      };
      await native().collection('log')
        .insertOne(entry);
      const log = String(entry._id);
      await native().collection('annotations')
        .updateMany(annotations, { $set: { backup: true, deletedWithProject: log } });
      await native().collection('projects')
        .deleteMany({ shortname });

      return log;
    };

    it('a delete logs { key, value, date } with the project, its ObjectId and the count, and marks only the current annotations', async function () {
      const before = await doc('a3histopath');
      const { version } = await found('a3histopath');
      const res = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(Object.keys(res.body), ['success', 'log', 'annotations']);

      const logged = await logEntry(res.body.log);
      assert.instanceOf(logged._id, ObjectId);
      assert.deepEqual(Object.keys(logged), ['_id', 'key', 'value', 'date']);
      assert.equal(logged.key, 'adminDeleteProject');
      assert.match(logged.date, isoDate);
      assert.deepEqual(Object.keys(logged.value), ['username', 'shortname', 'projectId', 'project', 'annotations']);
      assert.instanceOf(logged.value.projectId, ObjectId);
      assert.equal(String(logged.value.projectId), String(before._id));
      assert.deepEqual(_.omit(logged.value, ['projectId', 'project']), {
        username: admin.username,
        shortname: 'a3histopath',
        annotations: 3
      });
      assert.deepEqual(logged.value.project, _.omit(before, ['_id']));

      assert.isNull(await doc('a3histopath'));
      const anns = await allAnnotations('a3histopath');
      assert.lengthOf(anns, 4);
      anns.slice(0, 3).forEach((a) => assert.deepInclude(a, { backup: true, deletedWithProject: res.body.log }));
      assert.isTrue(anns[3].backup);
      assert.notProperty(anns[3], 'deletedWithProject', 'the older backup is not marked');
    }).timeout(U.shortTimeout);

    it('the owner\'s delete and the admin\'s delete leave the same database', async function () {
      const effect = async (deleteIt, username, key) => {
        await reset();
        const before = await doc('a3owned');
        const res = await deleteIt();
        assert.equal(res.status, 200, res.text);
        const logged = await logEntry(res.body.log);
        assert.equal(logged.key, key);
        assert.equal(logged.value.username, username);
        assert.instanceOf(logged.value.projectId, ObjectId);
        assert.equal(String(logged.value.projectId), String(before._id));
        const anns = await allAnnotations('a3owned');

        return {
          log: { ..._.omit(logged, ['_id', 'key', 'date']), value: _.omit(logged.value, ['username', 'projectId']) },
          annotations: anns.map((a) => ({ ..._.omit(a, ['_id']), ...(a.deletedWithProject ? { deletedWithProject: a.deletedWithProject === res.body.log } : {}) })),
          project: await native().collection('projects')
            .countDocuments({ shortname: 'a3owned' })
        };
      };
      const byOwner = await effect(() => agents[owner.username].delete('/project/json/a3owned'), owner.username, 'deleteProject');
      const byAdmin = await effect(async () => post('/admin/json/projects/delete', { project: 'a3owned', version: (await found('a3owned')).version }), admin.username, 'adminDeleteProject');
      assert.deepEqual(byAdmin, byOwner);
      assert.equal(byOwner.project, 0);
      assert.equal(byOwner.log.value.annotations, 2);
      assert.deepEqual(byOwner.annotations.map((a) => [a.backup, 'deletedWithProject' in a]), [[true, true], [true, false], [true, true]]);
    }).timeout(U.mediumTimeout);

    it('a restore puts the project back under its ObjectId, logs it, and unmarks only what the delete marked', async function () {
      const before = await doc('a3histopath');
      const annotations = await allAnnotations('a3histopath');
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      const deleteEntry = await logEntry(deleted.body.log);

      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body, { success: true, shortname: 'a3histopath', annotations: 3, version });
      const after = await doc('a3histopath');
      assert.instanceOf(after._id, ObjectId);
      assert.equal(String(after._id), String(before._id));
      assert.deepEqual(after, before);
      assert.deepEqual(await allAnnotations('a3histopath'), annotations, 'marks removed, the older backup stays a backup');

      const [restoreLog] = await native().collection('log')
        .find({ key: 'adminRestoreDeletedProject', 'value.shortname': 'a3histopath' })
        .toArray();
      assert.instanceOf(restoreLog._id, ObjectId);
      assert.deepEqual(Object.keys(restoreLog), ['_id', 'key', 'value', 'date']);
      assert.match(restoreLog.date, isoDate);
      assert.deepEqual(restoreLog.value, { username: admin.username, shortname: 'a3histopath', restored: deleted.body.log, annotations: 3 });
      const deleteAfter = await logEntry(deleted.body.log);
      assert.deepEqual(Object.keys(deleteAfter.value), ['username', 'shortname', 'projectId', 'project', 'annotations', 'restored']);
      assert.deepEqual(deleteAfter, { ...deleteEntry, value: { ...deleteEntry.value, restored: String(restoreLog._id) } });
    }).timeout(U.shortTimeout);

    it('restores a delete logged as 3cd20a4 did under the same ObjectId', async function () {
      const before = await doc('a3histopath');
      const annotations = await allAnnotations('a3histopath');
      const { version } = await found('a3histopath');
      const log = await oldDelete('a3histopath', 'a3-voyageour');
      const logged = await logEntry(log);
      assert.instanceOf(logged.value.projectId, ObjectId);
      assert.equal(logged.value.annotations, 3);
      assert.isNull(await doc('a3histopath'));

      const res = await post('/admin/json/projects/restore-deleted', { log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body, { success: true, shortname: 'a3histopath', annotations: 3, version });
      const after = await doc('a3histopath');
      assert.instanceOf(after._id, ObjectId);
      assert.equal(String(after._id), String(before._id));
      assert.deepEqual(after, before);
      assert.deepEqual(await allAnnotations('a3histopath'), annotations);
      assert.isString((await logEntry(log)).value.restored);
    }).timeout(U.shortTimeout);

    it('a second restore (409) changes nothing', async function () {
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal((await post('/admin/json/projects/restore-deleted', { log: deleted.body.log })).status, 200);
      const entries = await native().collection('log')
        .find({ 'value.shortname': 'a3histopath' })
        .toArray();
      const annotations = await allAnnotations('a3histopath');
      const project = await doc('a3histopath');
      const again = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(again.status, 409);
      assert.deepEqual(await native().collection('log')
        .find({ 'value.shortname': 'a3histopath' })
        .toArray(), entries);
      assert.deepEqual(await allAnnotations('a3histopath'), annotations);
      assert.deepEqual(await doc('a3histopath'), project);
    }).timeout(U.shortTimeout);

    it('a refused restore (409, the shortname exists again) writes nothing', async function () {
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      await U.insertProject({ ...histoPath(), name: 'a new one' });
      const deleteEntry = await logEntry(deleted.body.log);
      const annotations = await allAnnotations('a3histopath');
      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 409);
      assert.deepEqual(await logEntry(deleted.body.log), deleteEntry);
      assert.deepEqual(await allAnnotations('a3histopath'), annotations);
      assert.equal(await native().collection('log')
        .countDocuments({ key: 'adminRestoreDeletedProject', 'value.shortname': 'a3histopath' }), 0);
    }).timeout(U.shortTimeout);

    it('a refused delete (409, changed version) writes nothing', async function () {
      const { version } = await found('a3histopath');
      await native().collection('projects')
        .updateOne({ shortname: 'a3histopath' }, { $set: { description: 'changed meanwhile' } });
      const annotations = await allAnnotations('a3histopath');
      const res = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(res.status, 409);
      assert.deepEqual(await allAnnotations('a3histopath'), annotations);
      assert.equal(await native().collection('log')
        .countDocuments({ 'value.shortname': 'a3histopath' }), 0);
    }).timeout(U.shortTimeout);

    it('answers 404 for a log id in capitals, of another length, or not a string', async function () {
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      let res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log.toUpperCase() });
      assert.equal(res.status, 404, 'capitals');
      res = await post('/admin/json/projects/restore-deleted', { log: `${deleted.body.log}0` });
      assert.equal(res.status, 404, 'too long');
      res = await post('/admin/json/projects/restore-deleted', { log: 'zzzzzzzzzzzzzzzzzzzzzzzz' });
      assert.equal(res.status, 404, '24 non-hex');
      for (const logId of [12345, null, [deleted.body.log], { $ne: null }, deleted.body.log.toUpperCase(), 'not-an-id']) {
        // eslint-disable-next-line no-await-in-loop
        const result = await projectActions.restoreDeleted(appDb, { logId, username: admin.username });
        assert.equal(result.status, 404, JSON.stringify(logId));
      }
      // no database access for an id that cannot be one
      const noDb = new Proxy({}, { get: () => { throw new Error('database used'); } });
      for (const logId of [12345, deleted.body.log.toUpperCase(), 'zzzzzzzzzzzzzzzzzzzzzzzz', '']) {
        // eslint-disable-next-line no-await-in-loop
        assert.isNull(await findDeleteEntry(noDb, logId));
      }
      assert.isNull(await doc('a3histopath'), 'still deleted');
      res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, 'the id in lowercase');
    }).timeout(U.shortTimeout);

    it('a search lists maxFound (20) projects in shortname order, and says there were more', async function () {
      const many = _.range(22).map((n) => ({ ...owned(), name: `A3 many ${n}`, shortname: `a3many${String(n).padStart(2, '0')}` }));
      const names = many.map((p) => p.shortname);
      try {
        await U.insertProject(_.shuffle(many));
        let res = await get('/admin/json/projects/search', { q: 'a3many' });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.body.list.map((p) => p.shortname), names.slice(0, 20));
        assert.isTrue(res.body.more);
        await native().collection('projects')
          .deleteMany({ shortname: { $in: names.slice(20) } });
        res = await get('/admin/json/projects/search', { q: 'a3many' });
        assert.lengthOf(res.body.list, 20);
        assert.isFalse(res.body.more);
        res = await get('/admin/json/projects/search', { q: 'A3 MANY 1' });
        assert.deepEqual(res.body.list.map((p) => p.shortname), ['a3many01', ...names.slice(10, 20)].sort());
        assert.isFalse(res.body.more);
      } finally {
        await native().collection('projects')
          .deleteMany({ shortname: { $in: names } });
      }
    }).timeout(U.shortTimeout);

    it('the search counts only current annotations, and reads the users for ownerExists', async function () {
      const res = await get('/admin/json/projects/search', { q: 'a3' });
      const byName = _.keyBy(res.body.list.filter((p) => shortnames.includes(p.shortname)), 'shortname');
      assert.deepEqual(_.mapValues(byName, (p) => [p.ownerExists, p.counts.annotations]), {
        a3histopath: [false, 3],
        a3noanyone: [false, 0],
        a3owned: [true, 1]
      });
    }).timeout(U.shortTimeout);

    // One after the other, with the legacy-driver guard of mocha.test.util.js
    it('search, delete, restore and transfer, one after the other', async function () {
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(deleted.status, 200, deleted.text);
      const restored = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(restored.status, 200, restored.text);
      const transferred = await post('/admin/json/projects/transfer', { project: 'a3histopath', version, owner: owner.username });
      assert.equal(transferred.status, 200, transferred.text);
      const byOwner = await agents[owner.username].delete('/project/json/a3owned');
      assert.equal(byOwner.status, 200, byOwner.text);
      const back = await projectActions.restoreDeleted(appDb, { logId: byOwner.body.log, username: admin.username });
      assert.equal(back.annotations, 1);
    }).timeout(U.shortTimeout);

    // The log insert of 3cd20a4 refused keys with '.' or starting with '$'
    it('deletes and restores a project holding a key with a dot or a dollar', async function () {
      await U.removeProject('a3histopath');
      await native().collection('projects')
        .insertOne({ ...histoPath(), extra: { 'a.b': 1, '$c': 2 } });
      const before = await doc('a3histopath');
      assert.deepEqual(before.extra, { 'a.b': 1, '$c': 2 });
      const { version } = await found('a3histopath');
      const deleted = await post('/admin/json/projects/delete', { project: 'a3histopath', version });
      assert.equal(deleted.status, 200, deleted.text);
      const res = await post('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await doc('a3histopath'), before);
    }).timeout(U.shortTimeout);
  });
});
