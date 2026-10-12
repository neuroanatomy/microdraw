/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');

// A1: the admin page and its orphan-annotation tools (decisions D26).
// Orphans = current (non-backup) annotation documents whose project is empty,
// null, missing, or names a project that does not exist.
// eslint-disable-next-line max-statements
describe('Admin: orphan annotations (A1)', function () {
  const admin = { username: 'a1-admin', password: 'a1-admin-password' };
  const other = { username: 'a1-other', password: 'a1-other-password' };
  const tokens = {};
  const agents = {};

  const img1 = 'http://a1-admin-test.localhost/img1.dzi';
  const img2 = 'http://a1-admin-test.localhost/img2.dzi';
  const img3 = 'http://a1-admin-test.localhost/img3.dzi';
  const fileID = (source, slice) => `${source}&slice=${slice}`;

  const project = (shortname, sources, backup) => ({
    name: `A1 ${shortname}`,
    shortname,
    url: '',
    created: '2026-10-12T00:00:00.000Z',
    owner: 'a1-owner',
    collaborators: { list: [{ username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'none', files: 'none' } }] },
    files: { list: sources.map((source) => ({ source, name: source.split('/').pop() })) },
    annotations: { list: [] },
    ...(backup ? { backup: true } : {})
  });
  const live = project('a1adminlive', [img1]);
  const otherProject = project('a1adminother', []);
  // a deleted project: only a backup document is left
  const goneBackup = project('a1admingone', [img2], true);

  let n = 0;
  const region = (doc) => {
    n += 1;
    const out = { fileID: doc.fileID, user: doc.user, Hash: 'h', annotation: { name: `r${n}`, uid: `a1uid${n}`, path: ['Path', { segments: [[0, 0], [1, 1], [2, 0]], closed: true }] } };
    if ('project' in doc) {
      out.project = doc.project;
    }
    if (doc.backup) {
      out.backup = true;
    }

    return out;
  };
  const fixtures = () => [
    // img1 slice 0: alice with project '' (2 current, 1 backup)
    region({ fileID: fileID(img1, 0), user: 'alice', project: '' }),
    region({ fileID: fileID(img1, 0), user: 'alice', project: '' }),
    region({ fileID: fileID(img1, 0), user: 'alice', project: '', backup: true }),
    // img1 slice 0: bob, no project field at all
    region({ fileID: fileID(img1, 0), user: 'bob' }),
    // img1 slice 1: alice, project null
    region({ fileID: fileID(img1, 1), user: 'alice', project: null }),
    // img1 slice 0: alice in a live project, not an orphan
    region({ fileID: fileID(img1, 0), user: 'alice', project: live.shortname }),
    // img2 slice 0: a project that never existed, and a deleted one
    region({ fileID: fileID(img2, 0), user: 'alice', project: 'a1adminnever' }),
    region({ fileID: fileID(img2, 0), user: 'carol', project: 'a1admingone' }),
    region({ fileID: fileID(img2, 0), user: 'carol', project: 'a1admingone' }),
    // img3: only backups, not orphans
    region({ fileID: fileID(img3, 0), user: 'dan', project: '', backup: true })
  ];

  const login = async (user) => {
    const agent = await U.logIn(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    agents[user.username] = agent;
    tokens[user.username] = token;
  };

  const get = (path, query = {}, user = admin) => chai.request(U.serverURL).get(path)
    .query({ ...query, token: tokens[user.username] });
  const post = (path, body, user = admin) => chai.request(U.serverURL).post(path)
    .query({ token: tokens[user.username] })
    .send(body);
  const orphans = async (source, query = {}) => {
    const res = await get('/admin/json/orphans', { source, ...query });
    assert.equal(res.status, 200);

    return res.body;
  };
  const groupKey = (g) => `${g.slice}|${g.user}|${JSON.stringify(g.project)}`;
  const db = () => U.getDB();

  let previousAdmins;

  const cleanup = async () => {
    await Promise.all([img1, img2, img3].map((s) => U.removeAnnotations(s)));
    await Promise.all([live, otherProject, goneBackup].map((p) => U.removeProject(p.shortname)));
    await db().get('log')
      .remove({ key: /^admin/, 'value.fileID': new RegExp('^http://a1-admin-test\\.localhost/') });
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    previousAdmins = admins.getAdmins();
    await Promise.all([admin, other].map(login));
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await cleanup();
    await Promise.all([admin, other].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await cleanup();
    await U.insertProject([live, otherProject, goneBackup]);
    await U.insertAnnotations(fixtures());
  });

  describe('Access', function () {
    const jsonRoutes = [
      ['get', '/admin/json/orphans'],
      ['get', '/admin/json/orphans/projects'],
      ['post', '/admin/json/orphans/remove'],
      ['post', '/admin/json/orphans/restore'],
      ['post', '/admin/json/orphans/assign']
    ];

    it('refuses the JSON routes to anonymous visitors (401) and to non-admins (403)', async function () {
      for (const [method, path] of jsonRoutes) {
        // eslint-disable-next-line no-await-in-loop
        const anonymous = await chai.request(U.serverURL)[method](path);
        assert.equal(anonymous.status, 401, `${method} ${path} anonymous`);
        // eslint-disable-next-line no-await-in-loop
        const byToken = await chai.request(U.serverURL)[method](path)
          .query({ token: tokens[other.username] });
        assert.equal(byToken.status, 403, `${method} ${path} non-admin, token`);
        // eslint-disable-next-line no-await-in-loop
        const bySession = await agents[other.username][method](path);
        assert.equal(bySession.status, 403, `${method} ${path} non-admin, session`);
      }
    }).timeout(U.mediumTimeout);

    it('lets an admin logged in with a session use the JSON routes', async function () {
      const res = await agents[admin.username].get('/admin/json/orphans')
        .query({ source: img1 });
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 3);
    }).timeout(U.shortTimeout);
  });

  describe('Orphan detection', function () {
    // eslint-disable-next-line max-statements
    it('groups the orphans of an image by slice, author and project value, without backups or live projects', async function () {
      const { total, list } = await orphans(img1);
      assert.equal(total, 3);
      const byKey = Object.fromEntries(list.map((g) => [groupKey(g), g]));
      assert.sameMembers(Object.keys(byKey), ['0|alice|""', '0|bob|null', '1|alice|null']);
      assert.equal(byKey['0|alice|""'].regions, 2, 'the backup is not counted');
      assert.equal(byKey['0|bob|null'].regions, 1, 'a missing project field is an orphan');
      assert.equal(byKey['1|alice|null'].regions, 1, 'a null project is an orphan');
      for (const g of list) {
        assert.equal(g.source, img1);
        assert.equal(g.fileID, fileID(img1, g.slice));
        assert.equal(g.reason, 'none');
        assert.match(g.modified, /^\d{4}-\d\d-\d\dT/);
      }
    }).timeout(U.shortTimeout);

    it('lists annotations of a project that never existed, or was deleted (only a backup left)', async function () {
      const { total, list } = await orphans(img2);
      assert.equal(total, 2);
      const byKey = Object.fromEntries(list.map((g) => [groupKey(g), g]));
      assert.equal(byKey['0|alice|"a1adminnever"'].reason, 'missing');
      assert.equal(byKey['0|carol|"a1admingone"'].regions, 2);
      assert.equal(byKey['0|carol|"a1admingone"'].reason, 'missing');
    }).timeout(U.shortTimeout);

    it('does not list documents that are only backups', async function () {
      const { total, list } = await orphans(img3);
      assert.equal(total, 0);
      assert.deepEqual(list, []);
    }).timeout(U.shortTimeout);

    it('pages the list (skip, limit) and reports the total', async function () {
      const all = (await orphans(img1)).list.map(groupKey);
      const first = await orphans(img1, { limit: 1 });
      assert.equal(first.total, 3);
      assert.equal(first.limit, 1);
      assert.deepEqual(first.list.map(groupKey), all.slice(0, 1));
      const rest = await orphans(img1, { skip: 1, limit: 5 });
      assert.deepEqual(rest.list.map(groupKey), all.slice(1));
    }).timeout(U.shortTimeout);
  });

  describe('Delete (mark as backup) and undo', function () {
    const aliceEmpty = { fileID: fileID(img1, 0), user: 'alice', project: '' };

    // eslint-disable-next-line max-statements
    it('marks the group as backup, logs who did it, and can be undone', async function () {
      const res = await post('/admin/json/orphans/remove', aliceEmpty);
      assert.equal(res.status, 200);
      assert.equal(res.body.removed, 2);
      assert.isString(res.body.log);
      assert.notInclude((await orphans(img1)).list.map(groupKey), '0|alice|""');
      // nothing deleted: 3 documents, all backups now
      const docs = await db().get('annotations')
        .find({ fileID: aliceEmpty.fileID, user: 'alice', project: '' });
      assert.equal(docs.length, 3);
      assert.isTrue(docs.every((d) => d.backup === true));
      const logEntry = await db().get('log')
        .findOne({ key: 'adminRemoveOrphans', 'value.fileID': aliceEmpty.fileID });
      assert.equal(logEntry.value.username, admin.username);
      assert.lengthOf(logEntry.value.ids, 2);

      const undo = await post('/admin/json/orphans/restore', { log: res.body.log });
      assert.equal(undo.status, 200);
      assert.equal(undo.body.restored, 2);
      const again = (await orphans(img1)).list.find((g) => groupKey(g) === '0|alice|""');
      assert.equal(again.regions, 2, 'the older backup stays a backup');
      assert.isOk(await db().get('log')
        .findOne({ key: 'adminRestoreOrphans', 'value.username': admin.username, 'value.fileID': aliceEmpty.fileID }));

      const twice = await post('/admin/json/orphans/restore', { log: res.body.log });
      assert.equal(twice.status, 409);
    }).timeout(U.shortTimeout);

    it('removes a group without a project field (project null)', async function () {
      const res = await post('/admin/json/orphans/remove', { fileID: fileID(img1, 0), user: 'bob', project: null });
      assert.equal(res.status, 200);
      assert.equal(res.body.removed, 1);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('refuses annotations of a live project (409), unknown groups (404) and bad requests (400)', async function () {
      const liveGroup = await post('/admin/json/orphans/remove', { fileID: fileID(img1, 0), user: 'alice', project: live.shortname });
      assert.equal(liveGroup.status, 409);
      assert.equal((await U.findAnnotations({ project: live.shortname })).length, 1);
      const unknown = await post('/admin/json/orphans/remove', { fileID: fileID(img3, 0), user: 'dan', project: '' });
      assert.equal(unknown.status, 404);
      const bad = await post('/admin/json/orphans/remove', { fileID: fileID(img1, 0), user: 'alice' });
      assert.equal(bad.status, 400);
      const badLog = await post('/admin/json/orphans/restore', { log: 'not-an-id' });
      assert.equal(badLog.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('Assign to a project', function () {
    const aliceEmpty = { fileID: fileID(img1, 0), user: 'alice', project: '' };
    const carolGone = { fileID: fileID(img2, 0), user: 'carol', project: 'a1admingone' };

    it('offers the projects that list the image, with the annotations they already have', async function () {
      const res = await get('/admin/json/orphans/projects', { fileID: aliceEmpty.fileID, user: 'alice' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.list.map((p) => p.shortname), [live.shortname]);
      assert.equal(res.body.list[0].existing, 1);
      assert.equal(res.body.list[0].existingByUser, 1);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('assigns to a project that lists the image, keeping the annotations it already had', async function () {
      const res = await post('/admin/json/orphans/assign', { ...aliceEmpty, target: live.shortname });
      assert.equal(res.status, 200);
      assert.equal(res.body.assigned, 2);
      assert.equal(res.body.existingByUser, 1);
      assert.isFalse(res.body.addedImage);
      assert.equal((await U.findAnnotations({ fileID: aliceEmpty.fileID, project: live.shortname })).length, 3);
      assert.notInclude((await orphans(img1)).list.map(groupKey), '0|alice|""');
      // the backup keeps its old project
      assert.equal((await db().get('annotations')
        .find({ fileID: aliceEmpty.fileID, project: '' })).length, 1);
      const logEntry = await db().get('log')
        .findOne({ key: 'adminAssignOrphans', 'value.fileID': aliceEmpty.fileID });
      assert.include(logEntry.value, { username: admin.username, from: '', to: live.shortname });
    }).timeout(U.shortTimeout);

    it('refuses a project that does not list the image, unless asked to add it (409)', async function () {
      const res = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname });
      assert.equal(res.status, 409);
      assert.equal((await orphans(img2)).total, 2);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('adds the image to the project ({name, source}) and assigns, in one action', async function () {
      const res = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname, addImage: true });
      assert.equal(res.status, 200);
      assert.equal(res.body.assigned, 2);
      assert.isTrue(res.body.addedImage);
      assert.equal(res.body.existing, 0);
      const stored = await U.queryProject(otherProject.shortname);
      assert.deepEqual(stored.files.list, [{ name: 'img2.dzi', source: img2 }]);
      assert.equal((await U.findAnnotations({ fileID: carolGone.fileID, project: otherProject.shortname })).length, 2);
      // the project page offers it now
      const offered = await get('/admin/json/orphans/projects', { fileID: carolGone.fileID, user: 'carol' });
      assert.deepEqual(offered.body.list.map((p) => p.shortname), [otherProject.shortname]);
    }).timeout(U.shortTimeout);

    it('answers 404 for a project that does not exist, and changes nothing', async function () {
      const res = await post('/admin/json/orphans/assign', { ...aliceEmpty, target: 'a1adminnosuch', addImage: true });
      assert.equal(res.status, 404);
      const gone = await post('/admin/json/orphans/assign', { ...aliceEmpty, target: 'a1admingone', addImage: true });
      assert.equal(gone.status, 404, 'a deleted project (backup only) does not exist');
      assert.equal((await orphans(img1)).total, 3);
    }).timeout(U.shortTimeout);
  });
});
