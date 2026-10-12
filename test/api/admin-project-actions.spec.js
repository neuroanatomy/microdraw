/* eslint-disable max-lines, max-statements -- one test per behaviour, with its checks */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const lock = require('../../app/controller/projectLock');

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
  const stored = (shortname) => db().get('projects')
    .findOne({ shortname });
  const annotationsOf = (shortname) => db().get('annotations')
    .find({ project: shortname }, { sort: { _id: 1 } });
  const logs = (shortname) => db().get('log')
    .find({ key: /^admin/, 'value.shortname': shortname });

  const search = async (q) => {
    const res = await get('/admin/json/projects/search', { q });
    assert.equal(res.status, 200, res.text);

    return res.body.list.filter((p) => shortnames.includes(p.shortname));
  };
  const found = async (shortname) => (await search(shortname)).find((p) => p.shortname === shortname);

  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await Promise.all(shortnames.map((s) => U.removeProjectAnnotations(s)));
    await db().get('log')
      .remove({ 'value.shortname': { $in: shortnames } });
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    await Promise.all([admin, other, owner].map(login));
    previousAdmins = admins.getAdmins();
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
      const marked = await db().get('annotations')
        .find({ project: 'a3histopath', deletedWithProject: res.body.log });
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
      await db().get('projects')
        .update({ shortname: 'a3histopath' }, { $set: { description: 'changed meanwhile' } });
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
      assert.lengthOf(await db().get('projects')
        .find({ shortname: 'a3histopath' }), 1);
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
      await db().get('projects')
        .update({ shortname: 'a3histopath' }, { $set: { name: 'renamed meanwhile' } });
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
});
