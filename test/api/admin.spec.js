/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const { ObjectId } = require('neuroweblab');
const admins = require('../../app/controller/admin/admins');
const adminAnnotations = require('../../app/controller/admin/admin.annotations');
const { toId } = require('../../app/controller/toId');

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
  const lookalike = 'http://a1-admin-test.localhost/img1xdzi';
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
    await Promise.all([img1, img2, img3, lookalike].map((s) => U.removeAnnotations(s)));
    await Promise.all([live, otherProject, goneBackup, { shortname: 'a1adminold' }].map((p) => U.removeProject(p.shortname)));
    await db().collection('log')
      .deleteMany({ key: /^admin/, 'value.fileID': new RegExp('^http://a1-admin-test\\.localhost/') });
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
      const docs = await db().collection('annotations')
        .find({ fileID: aliceEmpty.fileID, user: 'alice', project: '' })
        .toArray();
      assert.equal(docs.length, 3);
      assert.isTrue(docs.every((d) => d.backup === true));
      const logEntry = await db().collection('log')
        .findOne({ key: 'adminRemoveOrphans', 'value.fileID': aliceEmpty.fileID });
      assert.equal(logEntry.value.username, admin.username);
      assert.lengthOf(logEntry.value.ids, 2);

      const undo = await post('/admin/json/orphans/restore', { log: res.body.log });
      assert.equal(undo.status, 200);
      assert.equal(undo.body.restored, 2);
      const again = (await orphans(img1)).list.find((g) => groupKey(g) === '0|alice|""');
      assert.equal(again.regions, 2, 'the older backup stays a backup');
      assert.isOk(await db().collection('log')
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
      assert.equal((await db().collection('annotations')
        .find({ fileID: aliceEmpty.fileID, project: '' })
        .toArray()).length, 1);
      const logEntry = await db().collection('log')
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

  // What the tools leave in the database, read through the native driver: they
  // change production's annotations, so documents, flags, log entries and id
  // types are compared in full, not only the answers.
  // eslint-disable-next-line max-statements
  describe('What ends in the database', function () {
    const aliceEmpty = { fileID: fileID(img1, 0), user: 'alice', project: '' };
    const carolGone = { fileID: fileID(img2, 0), user: 'carol', project: 'a1admingone' };
    const testFiles = { fileID: /^http:\/\/a1-admin-test\.localhost\// };
    const native = () => U.getNativeDB();
    const plain = (doc) => JSON.parse(JSON.stringify(doc));
    const byId = (a, b) => String(a._id).localeCompare(String(b._id));
    const annotationDocs = async () => plain((await native().collection('annotations')
      .find(testFiles)
      .toArray()).sort(byId));
    const projectDocs = async () => plain((await native().collection('projects')
      .find({ shortname: /^a1admin/ })
      .toArray()).sort(byId));
    const logEntries = (key) => native().collection('log')
      .find({ key, 'value.fileID': testFiles.fileID })
      .toArray();
    const isCurrent = (doc) => !('backup' in doc);
    const idsOf = (docs, group) => docs
      .filter((d) => isCurrent(d) && d.user === group.user && d.project === group.project)
      .map((d) => d._id);
    const assertIdsAreObjectIds = async () => {
      const annotations = await native().collection('annotations')
        .countDocuments({ ...testFiles, _id: { $not: { $type: 'objectId' } } });
      assert.equal(annotations, 0, 'annotation ids');
      const logs = await native().collection('log')
        .countDocuments({ key: /^admin/, 'value.fileID': testFiles.fileID, _id: { $not: { $type: 'objectId' } } });
      assert.equal(logs, 0, 'log ids');
    };
    // The whole entry: nothing added, nothing missing, ids stored as strings.
    const assertLogEntry = (entry, key, value, ids) => {
      const { _id, date, ...rest } = entry;
      assert.match(date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.equal(String(_id).length, 24);
      if (ids) {
        assert.sameMembers(rest.value.ids, ids);
        rest.value.ids.forEach((id) => assert.isString(id));
      }
      assert.deepEqual(rest, { key, value: { ...value, ...(ids ? { ids: rest.value.ids } : {}) } });
    };

    // eslint-disable-next-line max-statements
    it('remove sets backup on the group only, and logs its ids', async function () {
      const before = await annotationDocs();
      const ids = idsOf(before, aliceEmpty);
      assert.lengthOf(ids, 2);
      const res = await post('/admin/json/orphans/remove', aliceEmpty);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body).sort(), ['log', 'removed', 'success']);
      assert.deepEqual(await annotationDocs(), before.map((d) => (ids.includes(d._id) ? { ...d, backup: true } : d)));
      const entries = await logEntries('adminRemoveOrphans');
      assert.lengthOf(entries, 1);
      assert.equal(String(entries[0]._id), res.body.log);
      assertLogEntry(entries[0], 'adminRemoveOrphans', { username: admin.username, ...aliceEmpty }, ids);
      await assertIdsAreObjectIds();
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('restore gives back the documents as they were, and logs it', async function () {
      const before = await annotationDocs();
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      const res = await post('/admin/json/orphans/restore', { log: removal.body.log });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { success: true, restored: 2 });
      assert.deepEqual(await annotationDocs(), before, 'no backup key left, the older backup still one');
      const entries = await logEntries('adminRestoreOrphans');
      assert.lengthOf(entries, 1);
      assertLogEntry(entries[0], 'adminRestoreOrphans', { username: admin.username, removal: removal.body.log, ...aliceEmpty, restored: 2 });
      assert.lengthOf(await logEntries('adminRemoveOrphans'), 1, 'the removal stays logged');
      await assertIdsAreObjectIds();
    }).timeout(U.shortTimeout);

    it('restore counts the documents it changed, not the ids logged', async function () {
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      const [entry] = await logEntries('adminRemoveOrphans');
      await native().collection('annotations')
        .deleteOne({ _id: new ObjectId(entry.value.ids[0]) });
      const res = await post('/admin/json/orphans/restore', { log: removal.body.log });
      assert.equal(res.body.restored, 1);
      const [restoreEntry] = await logEntries('adminRestoreOrphans');
      assert.equal(restoreEntry.value.restored, 1);
    }).timeout(U.shortTimeout);

    it('restore skips a logged id that is not one', async function () {
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      const [entry] = await logEntries('adminRemoveOrphans');
      await native().collection('log')
        .updateOne({ _id: entry._id }, { $set: { 'value.ids': [entry.value.ids[0], 'not-an-id', 'z'.repeat(24)] } });
      const res = await post('/admin/json/orphans/restore', { log: removal.body.log });
      assert.equal(res.status, 200);
      assert.equal(res.body.restored, 1);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('restore refuses (409) once the group has current documents again, and changes nothing', async function () {
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      await U.insertAnnotations([region(aliceEmpty)]);
      const before = await annotationDocs();
      const res = await post('/admin/json/orphans/restore', { log: removal.body.log });
      assert.equal(res.status, 409);
      assert.isFalse(res.body.success);
      assert.match(res.body.error, /current documents again/);
      assert.deepEqual(await annotationDocs(), before);
      assert.lengthOf(await logEntries('adminRestoreOrphans'), 0);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('restore answers 404 on a bad, an unknown or another action\'s log id, and 400 on no string', async function () {
      const assign = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname, addImage: true });
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      const before = await annotationDocs();
      const notFound = ['not-an-id', 'abc', '0123456789ab', 'z'.repeat(24), `${'0'.repeat(23)}g`, ` ${'0'.repeat(23)}`, '0'.repeat(24), assign.body.log];
      for (const log of notFound) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post('/admin/json/orphans/restore', { log });
        assert.equal(res.status, 404, log);
        assert.equal(res.body.error, 'No orphan removal with that log id');
      }
      for (const log of ['', 5, null, {}, [removal.body.log], true]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post('/admin/json/orphans/restore', { log });
        assert.equal(res.status, 400, JSON.stringify(log));
      }
      assert.deepEqual(await annotationDocs(), before);
      assert.lengthOf(await logEntries('adminRestoreOrphans'), 0);
    }).timeout(U.shortTimeout);

    it('toId takes a 24-digit hex string, in either case, and nothing else', function () {
      const hex = '0123456789abcdef01234567';
      assert.instanceOf(toId(hex), ObjectId);
      assert.equal(String(toId(hex)), hex);
      assert.equal(String(toId(hex.toUpperCase())), hex);
      for (const bad of ['', 'not-an-id', '0123456789ab', 'z'.repeat(24), `${hex}0`, ` ${hex.slice(1)}`, `${hex}\n`, null, undefined, 5, {}, [hex]]) { // eslint-disable-line no-undefined
        assert.isNull(toId(bad), JSON.stringify(bad));
      }
    });

    it('restore takes a log id in capitals', async function () {
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      const res = await post('/admin/json/orphans/restore', { log: removal.body.log.toUpperCase() });
      assert.equal(res.status, 200);
      assert.equal(res.body.restored, 2);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('assign sets project on the current documents only, and logs it', async function () {
      const before = await annotationDocs();
      const projects = await projectDocs();
      const ids = idsOf(before, aliceEmpty);
      const res = await post('/admin/json/orphans/assign', { ...aliceEmpty, target: live.shortname });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body).sort(), ['addedImage', 'assigned', 'existing', 'existingByUser', 'log', 'success']);
      assert.deepEqual(await annotationDocs(), before.map((d) => (ids.includes(d._id) ? { ...d, project: live.shortname } : d)));
      assert.deepEqual(await projectDocs(), projects, 'the project lists the image already');
      const entries = await logEntries('adminAssignOrphans');
      assert.lengthOf(entries, 1);
      assert.equal(String(entries[0]._id), res.body.log);
      assertLogEntry(entries[0], 'adminAssignOrphans', {
        username: admin.username,
        fileID: aliceEmpty.fileID,
        user: 'alice',
        from: '',
        to: live.shortname,
        addedImage: false,
        existing: 1,
        existingByUser: 1
      }, ids);
      await assertIdsAreObjectIds();
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('assign with addImage pushes one file on the project, and logs it', async function () {
      const before = await annotationDocs();
      const projects = await projectDocs();
      const ids = idsOf(before, carolGone);
      const res = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname, addImage: true });
      assert.equal(res.status, 200);
      assert.deepEqual(await annotationDocs(), before.map((d) => (ids.includes(d._id) ? { ...d, project: otherProject.shortname } : d)));
      assert.deepEqual(await projectDocs(), projects.map((p) => (p.shortname === otherProject.shortname
        ? { ...p, files: { list: [{ name: 'img2.dzi', source: img2 }] } }
        : p)));
      const [entry] = await logEntries('adminAssignOrphans');
      assertLogEntry(entry, 'adminAssignOrphans', {
        username: admin.username,
        fileID: carolGone.fileID,
        user: 'carol',
        from: 'a1admingone',
        to: otherProject.shortname,
        addedImage: true,
        existing: 0,
        existingByUser: 0
      }, ids);
    }).timeout(U.shortTimeout);

    it('assign does not add an image the project lists, also as a plain string', async function () {
      await native().collection('projects')
        .updateOne({ shortname: otherProject.shortname, backup: { $exists: false } }, { $set: { 'files.list': [img2] } });
      const projects = await projectDocs();
      const res = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname, addImage: true });
      assert.equal(res.status, 200);
      assert.isFalse(res.body.addedImage);
      assert.deepEqual(await projectDocs(), projects);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('assign does not push an image listed since the project was read', async function () {
      await native().collection('projects')
        .updateOne({ shortname: otherProject.shortname, backup: { $exists: false } }, { $set: { 'files.list': [{ name: 'img1.dzi', source: img1 }] } });
      const projects = await projectDocs();
      const staleProjects = Object.create(native().collection('projects'));
      staleProjects.findOne = async (query) => {
        const stored = await native().collection('projects')
          .findOne(query);

        return { ...stored, files: { list: [] } };
      };
      const staleDb = { collection: (name) => (name === 'projects' ? staleProjects : native().collection(name)) };
      const result = await adminAnnotations.assignOrphans(staleDb, { group: aliceEmpty, target: otherProject.shortname, addImage: true, username: admin.username });
      assert.equal(result.assigned, 2);
      assert.isFalse(result.addedImage);
      assert.deepEqual(await projectDocs(), projects);
      const [entry] = await logEntries('adminAssignOrphans');
      assert.isFalse(entry.value.addedImage);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('refused actions leave the database as it was, and no log entry', async function () {
      const before = await annotationDocs();
      const projects = await projectDocs();
      const unknown = { fileID: fileID(img3, 0), user: 'dan', project: '' };
      const liveGroup = { ...aliceEmpty, project: live.shortname };
      const refused = [
        ['remove', liveGroup, 409],
        ['remove', unknown, 404],
        ['assign', { ...liveGroup, target: otherProject.shortname }, 409],
        ['assign', { ...unknown, target: live.shortname }, 404],
        ['assign', { ...carolGone, target: otherProject.shortname }, 409],
        ['assign', { ...carolGone, target: 'a1adminnosuch', addImage: true }, 404]
      ];
      for (const [action, body, status] of refused) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post(`/admin/json/orphans/${action}`, body);
        assert.equal(res.status, status, `${action} ${JSON.stringify(body)}`);
      }
      assert.deepEqual(await annotationDocs(), before);
      assert.deepEqual(await projectDocs(), projects);
      assert.lengthOf(await native().collection('log')
        .find({ key: /^admin/, 'value.fileID': testFiles.fileID })
        .toArray(), 0);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('offers projects by shortname, without backups, with the fields listed only', async function () {
      await native().collection('projects')
        .updateOne({ shortname: otherProject.shortname, backup: { $exists: false } }, { $set: { 'files.list': [img1] }, $unset: { name: '', owner: '' } });
      await U.insertProject({ ...project('a1adminold', [img1]), backup: true });
      const res = await get('/admin/json/orphans/projects', { fileID: aliceEmpty.fileID, user: 'alice' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.list, [
        { shortname: live.shortname, name: live.name, owner: live.owner, existing: 1, existingByUser: 1 },
        { shortname: otherProject.shortname, name: '', owner: '', existing: 0, existingByUser: 0 }
      ]);
      const byOther = await get('/admin/json/orphans/projects', { fileID: aliceEmpty.fileID, user: 'bob' });
      assert.equal(byOther.body.list[0].existing, 1);
      assert.equal(byOther.body.list[0].existingByUser, 0);
      const none = await get('/admin/json/orphans/projects', { fileID: fileID(img3, 0) });
      assert.deepEqual(none.body.list, []);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('lists whole rows, the newest first, and treats the source as text', async function () {
      await U.insertAnnotations([region({ fileID: fileID(lookalike, 0), user: 'alice', project: '' })]);
      await native().collection('annotations')
        .insertOne({ fileID: fileID(img3, 2), Hash: 'h', annotation: {} });
      const newest = (await annotationDocs()).find((d) => d.fileID === fileID(img3, 2));
      const { list } = await orphans(img3);
      assert.lengthOf(list, 1);
      assert.deepEqual(list[0], {
        fileID: fileID(img3, 2),
        source: img3,
        slice: '2',
        user: null,
        project: null,
        reason: 'none',
        regions: 1,
        modified: new Date(parseInt(newest._id.slice(0, 8), 16) * 1000).toJSON()
      });
      assert.equal((await orphans(lookalike)).total, 1);
      assert.equal((await orphans(img1)).total, 3, 'the . of the source is not a wildcard');
      const all = await orphans('', { limit: 500 });
      assert.isAtLeast(all.total, 7);
      const stamps = all.list.map((g) => g.modified);
      assert.deepEqual(stamps, [...stamps].sort().reverse());
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('lists, removes, restores and assigns, one after the other', async function () {
      assert.equal((await orphans(img1)).total, 3);
      const offered = await get('/admin/json/orphans/projects', { fileID: aliceEmpty.fileID, user: 'alice' });
      assert.lengthOf(offered.body.list, 1);
      const removal = await post('/admin/json/orphans/remove', aliceEmpty);
      assert.equal(removal.status, 200);
      const undo = await post('/admin/json/orphans/restore', { log: removal.body.log });
      assert.equal(undo.body.restored, 2);
      const assign = await post('/admin/json/orphans/assign', { ...carolGone, target: otherProject.shortname, addImage: true });
      assert.equal(assign.body.assigned, 2);
      assert.isTrue(assign.body.addedImage);
    }).timeout(U.shortTimeout);

    it('splits a fileID at the last &slice=', function () {
      assert.deepEqual(adminAnnotations.splitFileID('a.dzi&slice=3'), { source: 'a.dzi', slice: '3' });
      assert.deepEqual(adminAnnotations.splitFileID('a&slice=1&slice=2'), { source: 'a&slice=1', slice: '2' });
      assert.deepEqual(adminAnnotations.splitFileID('a.dzi'), { source: 'a.dzi', slice: '' });
      assert.deepEqual(adminAnnotations.splitFileID(null), { source: '', slice: '' });
    });

    it('checks a group: fileID, user and project', function () {
      assert.isNull(adminAnnotations.groupError({ fileID: 'a', user: null, project: null }));
      assert.isNull(adminAnnotations.groupError({ fileID: 'a', user: 'b', project: '' }));
      assert.match(adminAnnotations.groupError(), /fileID/);
      assert.match(adminAnnotations.groupError({ fileID: '', user: 'b', project: '' }), /fileID/);
      assert.match(adminAnnotations.groupError({ fileID: 'a', project: '' }), /user/);
      assert.match(adminAnnotations.groupError({ fileID: 'a', user: 'b' }), /project/);
    });
  });
});
