/* eslint-disable max-lines */
'use strict';

const _ = require('lodash');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const adminProjects = require('../../app/controller/admin/admin.projects');
const projectActions = require('../../app/controller/admin/admin.projectActions');
const adminAnnotations = require('../../app/controller/admin/admin.annotations');
const { projectVersion } = require('../../app/controller/project/project.check');

// T002 2.1b: every change of a project stores a new version. The new document
// is inserted (new _id), then the previous current one gets `backup: true`. A
// delete marks the current version `backup: true` + `deletedWithProject`;
// nothing is removed. Admin changes (fixes, their restore, transfer, a file
// added from orphans) make versions too.
// eslint-disable-next-line max-statements
describe('Project versions: every change keeps the old version (T002 2.1b)', function () {
  const PREFIX = 'pversions';
  const owner = { username: 'pversions-owner', password: 'pversions-owner-password' };
  const admin = { username: 'pversions-admin', password: 'pversions-admin-password' };
  const isoDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  const appDb = { nativeMongoDB: () => U.getNativeDB() };
  const source = (tag) => `/test_data/${PREFIX}-${tag}.dzi`;
  let adminToken, agent, previousAdmins;

  const db = () => U.getNativeDB();
  const versions = (shortname) => db().collection('projects')
    .find({ shortname }, { sort: { _id: 1 } })
    .toArray();
  const currents = (shortname) => db().collection('projects')
    .find({ shortname, backup: { $exists: false } }, { sort: { _id: 1 } })
    .toArray();
  const content = (doc) => _.omit(doc, ['_id', 'modified', 'modifiedBy', 'backup', 'deletedWithProject']);

  const project = (shortname, { name = 'Versions', files = [source('a')], extra = {} } = {}) => ({
    name,
    shortname,
    url: '',
    created: '2026-11-09T00:00:00.000Z',
    owner: owner.username,
    collaborators: { list: [{ username: 'anyone', access: { collaborators: 'view', annotations: 'view', files: 'view' } }] },
    files: { list: files.map((s) => ({ source: s, name: `${s} name` })) },
    annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '', display: true }, { type: 'text', name: 'Notes', values: '', display: true }] },
    ...extra
  });
  const save = (shortname, data) => agent.post(`/project/json/${shortname}`).send({ data });
  const json = (shortname) => chai.request(U.serverURL).get(`/project/json/${shortname}`);
  const page = (shortname) => chai.request(U.serverURL).get(`/project/${shortname}`);
  const adminPost = (route, body) => chai.request(U.serverURL).post(route)
    .query({ token: adminToken })
    .send(body);

  const removeAll = async () => {
    const ours = { $regex: `^${PREFIX}` };
    await Promise.all([
      db().collection('projects')
        .deleteMany({ shortname: ours }),
      db().collection('annotations')
        .deleteMany({ $or: [{ project: ours }, { fileID: { $regex: PREFIX } }] }),
      db().collection('textAnnotations')
        .deleteMany({ project: ours }),
      db().collection('log')
        .deleteMany({ 'value.shortname': ours }),
      db().collection('log')
        .deleteMany({ 'value.to': ours })
    ]);
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    await removeAll();
    agent = await U.logIn(owner);
    const adminAgent = await U.logIn(admin);
    adminToken = (await adminAgent.get('/token')).body.token;
    previousAdmins = admins.getAdmins();
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await removeAll();
    await U.removeLocalUser(owner.username);
    await U.removeLocalUser(admin.username);
  });

  describe('POST /project/json/:projectName (settings save)', function () {
    // eslint-disable-next-line max-statements
    it('stores one new version per save; the old one becomes a backup; reads give the new one', async function () {
      const shortname = `${PREFIX}save`;
      let res = await save(shortname, project(shortname, { name: 'First' }));
      assert.equal(res.status, 200, res.text);
      let docs = await versions(shortname);
      assert.lengthOf(docs, 1, 'a new project is a first version');
      assert.notProperty(docs[0], 'backup');

      res = await save(shortname, project(shortname, { name: 'Second', files: [source('a'), source('b')] }));
      assert.equal(res.status, 200, res.text);
      docs = await versions(shortname);
      assert.lengthOf(docs, 2);
      assert.isTrue(docs[0].backup);
      assert.equal(docs[0].name, 'First');
      assert.notProperty(docs[1], 'backup');
      assert.equal(docs[1].name, 'Second');
      assert.equal(String(res.body.response.insertedId), String(docs[1]._id));

      const answer = await json(shortname);
      assert.equal(answer.body.name, 'Second');
      assert.notProperty(answer.body, '_id', 'no _id in the JSON answer: it changes on every save');
      assert.lengthOf(answer.body.files.list, 2);
      const html = await page(shortname);
      assert.include(html.text, 'Second');
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('ignores an _id and a backup sent by the client, and sets modified (ISO string) and modifiedBy', async function () {
      const shortname = `${PREFIX}clientid`;
      await save(shortname, project(shortname));
      const [first] = await versions(shortname);
      const before = Date.now();
      const res = await save(shortname, { ...project(shortname, { name: 'With id' }), _id: String(first._id), backup: true, modified: '2000-01-01T00:00:00.000Z', modifiedBy: 'someone-else' });
      assert.equal(res.status, 200, res.text);
      const docs = await versions(shortname);
      assert.lengthOf(docs, 2);
      assert.notEqual(String(docs[1]._id), String(first._id));
      assert.equal(docs[0].name, 'Versions', 'the first version is not overwritten');
      assert.isTrue(docs[0].backup);
      assert.notProperty(docs[1], 'backup');
      assert.isString(docs[1].modified);
      assert.match(docs[1].modified, isoDate);
      assert.isAtLeast(Date.parse(docs[1].modified), before - 1000);
      assert.equal(docs[1].modifiedBy, owner.username);
    }).timeout(U.shortTimeout);

    // As the $set of NWL's upsertProject before 2.1b: a stored top-level field
    // that the client does not send is kept in the new version
    it('keeps a stored field the client does not send (description, created)', async function () {
      const shortname = `${PREFIX}keepfields`;
      await save(shortname, project(shortname, { extra: { description: 'Kept description' } }));
      const sent = _.omit(project(shortname, { name: 'Renamed' }), ['description', 'created']);
      const res = await save(shortname, sent);
      assert.equal(res.status, 200, res.text);
      const [now] = await currents(shortname);
      assert.equal(now.name, 'Renamed');
      assert.equal(now.description, 'Kept description');
      assert.equal(now.created, '2026-11-09T00:00:00.000Z');
    }).timeout(U.shortTimeout);

    it('two saves in parallel (lock) give two versions in order, and one current', async function () {
      const shortname = `${PREFIX}parallel`;
      await save(shortname, project(shortname));
      const results = await Promise.all(['A', 'B'].map((n) => save(shortname, project(shortname, { name: `Parallel ${n}` }))));
      results.forEach((res) => assert.equal(res.status, 200, res.text));
      const docs = await versions(shortname);
      assert.lengthOf(docs, 3);
      assert.deepEqual(docs.map((d) => d.backup === true), [true, true, false]);
      assert.sameMembers(docs.slice(1).map((d) => d.name), ['Parallel A', 'Parallel B']);
      assert.isAtMost(Date.parse(docs[1].modified), Date.parse(docs[2].modified), 'in the order of the lock');
      assert.equal((await json(shortname)).body.name, docs[2].name);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('a new project with the shortname of a deleted one is independent of its versions', async function () {
      const shortname = `${PREFIX}reborn`;
      await save(shortname, project(shortname, { name: 'Old life', files: [source('old')] }));
      await save(shortname, project(shortname, { name: 'Old life 2', files: [source('old')] }));
      const deleted = await agent.delete(`/project/json/${shortname}`);
      assert.equal(deleted.status, 200, deleted.text);
      const res = await save(shortname, project(shortname, { name: 'New life', files: [source('new')] }));
      assert.equal(res.status, 200, res.text);
      assert.include(res.body.message, 'New project created');
      const [current, ...more] = await currents(shortname);
      assert.isEmpty(more);
      assert.equal(current.name, 'New life');
      const answer = await json(shortname);
      assert.equal(answer.body.name, 'New life');
      assert.deepEqual(answer.body.files.list.map((f) => f.source), [source('new')]);
      const settings = await chai.request(U.serverURL).get(`/project/${shortname}/settings`);
      assert.notInclude(settings.text, 'Old life');
      assert.notInclude((await page(shortname)).text, 'Old life');
      const users = await agent.get(`/user/json/${owner.username}/projects`).query({ start: 0, length: 100 });
      assert.notInclude(JSON.stringify(users.body), 'Old life');
      // the old versions are still there, as backups
      assert.deepEqual((await versions(shortname)).map((d) => [d.name, d.backup === true]), [['Old life', true], ['Old life 2', true], ['New life', false]]);
      // and the delete cannot be restored over the new project
      const restore = await adminPost('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(restore.status, 409);
    }).timeout(U.shortTimeout);

    // The largest production project (Test Project) lists 2 150 files
    it('a project of 2 150 files: each save stores one version, under 1 MB', async function () {
      const shortname = `${PREFIX}large`;
      const files = _.range(2150).map((i) => `https://microdraw.example.org/data/TestProject/slide-${String(i).padStart(4, '0')}.dzi`);
      const data = project(shortname, { files });
      let res = await save(shortname, data);
      assert.equal(res.status, 200, res.text);
      res = await save(shortname, { ...data, name: 'Large, saved again' });
      assert.equal(res.status, 200, res.text);
      const sizes = await db().collection('projects')
        .aggregate([{ $match: { shortname } }, { $sort: { _id: 1 } }, { $project: { size: { $bsonSize: '$$ROOT' } } }])
        .toArray();
      assert.lengthOf(sizes, 2);
      sizes.forEach(({ size }) => assert.isBelow(size, 1024 * 1024));
    }).timeout(U.mediumTimeout);
  });

  describe('crash safety', function () {
    // eslint-disable-next-line max-statements
    it('a failure after the insert leaves two current versions; reads give the newest; the next save leaves one', async function () {
      // required here: the helper is new in 2.1b
      const { saveProjectVersion } = require('../../app/controller/project/currentProject'); // eslint-disable-line global-require
      const shortname = `${PREFIX}crash`;
      await save(shortname, project(shortname, { name: 'Before the crash' }));
      const projects = db().collection('projects');
      const failing = Object.create(projects);
      failing.updateMany = () => Promise.reject(new Error('crash after the insert'));
      const crashDb = { collection: (name) => (name === 'projects' ? failing : db().collection(name)) };
      let caught;
      try {
        await saveProjectVersion(crashDb, project(shortname, { name: 'Inserted, not marked' }), { by: owner.username });
      } catch (err) {
        caught = err;
      }
      assert.equal(caught && caught.message, 'crash after the insert');
      assert.deepEqual((await currents(shortname)).map((d) => d.name), ['Before the crash', 'Inserted, not marked']);
      assert.equal((await json(shortname)).body.name, 'Inserted, not marked');

      const res = await save(shortname, project(shortname, { name: 'After the crash' }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await currents(shortname)).map((d) => d.name), ['After the crash']);
      assert.lengthOf(await versions(shortname), 3);
    }).timeout(U.shortTimeout);
  });

  describe('delete and restore', function () {
    // eslint-disable-next-line max-statements
    it('a delete removes no document: the current version is marked; page and JSON answer 404', async function () {
      const shortname = `${PREFIX}delete`;
      await save(shortname, project(shortname, { name: 'Old' }));
      await save(shortname, project(shortname, { name: 'Deleted' }));
      const before = await versions(shortname);
      const res = await agent.delete(`/project/json/${shortname}`);
      assert.equal(res.status, 200, res.text);
      const after = await versions(shortname);
      assert.deepEqual(after.map((d) => String(d._id)), before.map((d) => String(d._id)), 'the same documents');
      assert.deepEqual(after.map((d) => [d.backup, d.deletedWithProject]), [[true, undefined], [true, res.body.log]]); // eslint-disable-line no-undefined
      assert.deepEqual(_.omit(after[1], ['backup', 'deletedWithProject']), before[1]);
      assert.equal((await json(shortname)).status, 404);
      assert.equal((await page(shortname)).status, 404);
      assert.lengthOf(await currents(shortname), 0);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('restore stores the logged content as a new current version; annotations and text values are current again', async function () {
      const shortname = `${PREFIX}restore`;
      await save(shortname, project(shortname, { name: 'Restored' }));
      const [stored] = await currents(shortname);
      await U.insertAnnotations([{ fileID: `${source('a')}&slice=0`, user: owner.username, project: shortname, Hash: 'h', annotation: { name: 'r', path: ['Path', { segments: [[0, 0], [1, 1], [2, 0]], closed: true }] } }]);
      await db().collection('textAnnotations')
        .insertOne({ project: shortname, source: source('a'), layer: 'Notes', value: 'a note', user: owner.username, modified: new Date() });
      const deleted = await agent.delete(`/project/json/${shortname}`);
      assert.equal(deleted.status, 200, deleted.text);
      assert.lengthOf(await U.findAnnotations({ project: shortname }), 0);

      const res = await adminPost('/admin/json/projects/restore-deleted', { log: deleted.body.log });
      assert.equal(res.status, 200, res.text);
      const docs = await versions(shortname);
      assert.lengthOf(docs, 2);
      assert.equal(String(docs[0]._id), String(stored._id));
      assert.isTrue(docs[0].backup, 'the deleted version stays a backup');
      assert.notProperty(docs[0], 'deletedWithProject', 'without the delete\'s mark');
      assert.notProperty(docs[1], 'backup');
      assert.notEqual(String(docs[1]._id), String(stored._id), 'a new _id');
      assert.deepEqual(content(docs[1]), content(stored));
      assert.equal(docs[1].modifiedBy, admin.username);
      assert.equal(res.body.version, projectVersion(docs[1]));
      assert.equal((await json(shortname)).body.name, 'Restored');
      assert.lengthOf(await U.findAnnotations({ project: shortname }), 1);
      const text = await chai.request(U.serverURL).get(`/project/json/${shortname}/text-annotations`);
      assert.equal(text.body[source('a')].Notes.value, 'a note');
    }).timeout(U.shortTimeout);
  });

  describe('admin changes make versions', function () {
    const expectNewVersion = async (shortname, before, check) => {
      const docs = await versions(shortname);
      assert.lengthOf(docs, 2);
      assert.equal(String(docs[0]._id), String(before._id));
      assert.deepEqual(docs[0], { ...before, backup: true }, 'the old version, unchanged, marked');
      assert.notProperty(docs[1], 'backup');
      assert.match(docs[1].modified, isoDate);
      assert.equal(docs[1].modifiedBy, admin.username);
      check(docs[1]);

      return docs[1];
    };

    it('remove blank rows', async function () {
      const shortname = `${PREFIX}blank`;
      await U.insertProject(project(shortname, { files: [source('a'), ''] }));
      const [before] = await versions(shortname);
      const res = await adminProjects.removeBlankRows(appDb, { shortname, version: projectVersion(before), username: admin.username });
      assert.isUndefined(res.error, res.error);
      const now = await expectNewVersion(shortname, before, (doc) => assert.lengthOf(doc.files.list, 1));
      assert.equal(res.version, projectVersion(now));
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('name layers, then the restore of that fix', async function () {
      const shortname = `${PREFIX}name`;
      const data = project(shortname);
      data.annotations.list[0] = { type: 'vectorial', name: '', values: 'Set 1', display: true };
      await U.insertProject(data);
      const [before] = await versions(shortname);
      const res = await adminProjects.nameLayers(appDb, { shortname, version: projectVersion(before), names: { 0: 'Cortex' }, username: admin.username });
      assert.isUndefined(res.error, res.error);
      const named = await expectNewVersion(shortname, before, (doc) => assert.equal(doc.annotations.list[0].name, 'Cortex'));
      assert.equal(res.version, projectVersion(named));

      const restored = await adminProjects.restoreProject(appDb, { logId: res.log, username: admin.username });
      assert.isUndefined(restored.error, restored.error);
      const docs = await versions(shortname);
      assert.lengthOf(docs, 3);
      assert.deepEqual(docs.map((d) => d.backup === true), [true, true, false]);
      assert.deepEqual(content(docs[2]), content(before));
      assert.equal(restored.version, projectVersion(docs[2]));
    }).timeout(U.shortTimeout);

    it('transfer the ownership', async function () {
      const shortname = `${PREFIX}transfer`;
      await U.insertProject(project(shortname));
      const [before] = await versions(shortname);
      const res = await projectActions.transferProject(appDb, { shortname, version: projectVersion(before), owner: admin.username, username: admin.username });
      assert.isUndefined(res.error, res.error);
      const now = await expectNewVersion(shortname, before, (doc) => assert.equal(doc.owner, admin.username));
      assert.deepEqual(_.omit(content(now), ['owner']), _.omit(content(before), ['owner']));
      assert.equal(res.version, projectVersion(now));
    }).timeout(U.shortTimeout);

    it('add a file from orphans', async function () {
      const shortname = `${PREFIX}orphans`;
      await U.insertProject(project(shortname));
      const [before] = await versions(shortname);
      const fileID = `${source('orphan')}&slice=0`;
      await U.insertAnnotations([{ fileID, user: 'pversions-someone', project: '', Hash: 'h', annotation: { name: 'o', path: ['Path', { segments: [[0, 0], [1, 1], [2, 0]], closed: true }] } }]);
      const group = { fileID, user: 'pversions-someone', project: '' };
      const res = await adminAnnotations.assignOrphans(db(), { group, target: shortname, addImage: true, username: admin.username });
      assert.isUndefined(res.error, res.error);
      assert.isTrue(res.addedImage);
      await expectNewVersion(shortname, before, (doc) => assert.deepEqual(doc.files.list.map((f) => f.source), [source('a'), source('orphan')]));
    }).timeout(U.shortTimeout);
  });
});
