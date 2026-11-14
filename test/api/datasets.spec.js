/* eslint-disable max-statements -- one test per behaviour, with its checks */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const sinon = require('sinon');
const U = require('../mocha.test.util');
const log = require('../../app/log');
const admins = require('../../app/controller/admin/admins');

// T002 3.3: one document per dataset (source URL) in `datasets`, created the
// first time a project version lists it (saveProjectVersion): owner = the
// user saving (an admin action: the project's owner), name = the row's name,
// included = now. Never changed by later saves, never deleted. Only http(s)
// sources. A failure to write it does not fail the save.
describe('Dataset documents created when a project first lists a dataset (T002 3.3)', function () {
  const PREFIX = 'ds33';
  const BASE = 'https://ds33-test.localhost/data/';
  const url = (name) => `${BASE}${name}.json`;
  const owner = { username: 'ds33-owner', password: 'ds33-owner-password' };
  const other = { username: 'ds33-other', password: 'ds33-other-password' };
  const editor = { username: 'ds33-editor', password: 'ds33-editor-password' };
  const admin = { username: 'ds33-admin', password: 'ds33-admin-password' };
  const access = (files) => ({ collaborators: 'view', annotations: 'view', files });
  let adminAgent, editorAgent, otherAgent, ownerAgent, previousAdmins;

  const db = () => U.getNativeDB();
  const datasets = () => db().collection('datasets');
  const ours = () => datasets().find({ source: { $regex: '^https://ds33-test\\.localhost/' } }, { projection: { _id: 0 }, sort: { source: 1 } })
    .toArray();
  const project = (shortname, files, extra = {}) => ({
    name: `Datasets ${shortname}`,
    shortname,
    url: '',
    description: '',
    collaborators: {
      list: [
        { username: 'anyone', userID: 'anyone', access: access('view') },
        { username: editor.username, userID: editor.username, access: access('add') }
      ]
    },
    files: { list: files },
    annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '', display: true }] },
    ...extra
  });
  const save = (agent, shortname, data) => agent.post(`/project/json/${shortname}`).send({ data });
  const saved = (res) => assert.equal(res.status, 200, res.text);

  const cleanup = async () => {
    await db().collection('projects')
      .deleteMany({ shortname: { $regex: `^${PREFIX}` } });
    await datasets().deleteMany({ source: { $regex: '^https://ds33-test\\.localhost/' } });
    await db().collection('annotations')
      .deleteMany({ fileID: { $regex: '^https://ds33-test\\.localhost/' } });
    await db().collection('log')
      .deleteMany({ key: /^admin/, 'value.fileID': { $regex: '^https://ds33-test\\.localhost/' } });
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    [ownerAgent, otherAgent, editorAgent, adminAgent] = await Promise.all([owner, other, editor, admin].map((u) => U.logIn(u)));
    previousAdmins = admins.getAdmins();
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await cleanup();
    await Promise.all([owner, other, editor, admin].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await cleanup();
  });

  it('the datasets collection has a unique index on source', async function () {
    const indexes = await datasets().indexes();
    const index = indexes.find((i) => i.name === 'source_1');
    assert.exists(index);
    assert.deepEqual(index.key, { source: 1 });
    assert.isTrue(index.unique);
  });

  it('a new project with 3 datasets creates 3 documents (owner: the creator, name: the row name)', async function () {
    const before = Date.now();
    saved(await save(ownerAgent, `${PREFIX}new`, project(`${PREFIX}new`, [
      { source: url('a'), name: 'Alpha' },
      { source: url('b'), name: 'Beta' },
      { source: url('c'), name: '' }
    ])));
    const docs = await ours();
    assert.deepEqual(docs.map((d) => [d.source, d.name, d.owner]), [
      [url('a'), 'Alpha', owner.username],
      [url('b'), 'Beta', owner.username],
      // an empty name: the last path segment without .json
      [url('c'), 'c', owner.username]
    ]);
    for (const d of docs) {
      assert.isString(d.included);
      assert.isAtLeast(Date.parse(d.included), before - 1000);
      assert.hasAllKeys(d, ['source', 'name', 'owner', 'included']);
    }
  }).timeout(U.shortTimeout);

  it('a second project listing a dataset under another name creates nothing and changes nothing', async function () {
    saved(await save(ownerAgent, `${PREFIX}first`, project(`${PREFIX}first`, [{ source: url('a'), name: 'Alpha' }])));
    const first = await ours();
    saved(await save(otherAgent, `${PREFIX}second`, project(`${PREFIX}second`, [{ source: url('a'), name: 'Another name' }])));
    assert.deepEqual(await ours(), first);
  }).timeout(U.shortTimeout);

  it('sources that are not http(s) URLs (a bare file name, a path) get no document', async function () {
    saved(await save(ownerAgent, `${PREFIX}bare`, project(`${PREFIX}bare`, [
      { source: '20200613_TL_100-00.jpg', name: '648' },
      { source: '/test_data/cat.json', name: 'cat' },
      { source: url('ok'), name: 'ok' }
    ])));
    assert.deepEqual((await datasets().find({ name: { $in: ['648', 'cat', 'ok'] } })
      .toArray()).map((d) => d.source), [url('ok')]);
  }).timeout(U.shortTimeout);

  it('a settings save that adds a dataset creates one (owner: the collaborator saving); one that removes it deletes nothing', async function () {
    const shortname = `${PREFIX}settings`;
    // stored before 3.3: its dataset has no document, and a save that does not
    // add it creates none
    await U.insertProject(project(shortname, [{ source: url('old'), name: 'Old' }], { owner: owner.username }));
    saved(await save(ownerAgent, shortname, project(shortname, [{ source: url('old'), name: 'Old renamed' }])));
    assert.deepEqual(await ours(), []);

    saved(await save(editorAgent, shortname, project(shortname, [{ source: url('old'), name: 'Old' }, { source: url('added'), name: 'Added' }])));
    const docs = await ours();
    assert.deepEqual(docs.map((d) => [d.source, d.name, d.owner]), [[url('added'), 'Added', editor.username]]);

    saved(await save(ownerAgent, shortname, project(shortname, [{ source: url('old'), name: 'Old' }])));
    assert.notInclude((await U.queryProject(shortname)).files.list.map((f) => f.source), url('added'));
    assert.deepEqual(await ours(), docs);
  }).timeout(U.shortTimeout);

  it('the admin assign path with addImage makes the project owner the owner, not the admin', async function () {
    const shortname = `${PREFIX}assign`;
    const source = url('orphan');
    await U.insertProject(project(shortname, [], { owner: owner.username }));
    await U.insertAnnotations([{ fileID: `${source}&slice=0`, user: other.username, project: `${PREFIX}gone`, Hash: 'ds33', annotation: { name: 'r', path: [] } }]);
    const res = await adminAgent.post('/admin/json/orphans/assign')
      .send({ fileID: `${source}&slice=0`, user: other.username, project: `${PREFIX}gone`, target: shortname, addImage: true });
    assert.equal(res.status, 200, res.text);
    assert.isTrue(res.body.addedImage);
    assert.deepEqual((await ours()).map((d) => [d.source, d.name, d.owner]), [[source, 'orphan.json', owner.username]]);
  }).timeout(U.shortTimeout);

  it('two concurrent saves adding the same new dataset give one document', async function () {
    const [r1, r2] = await Promise.all([
      save(ownerAgent, `${PREFIX}race1`, project(`${PREFIX}race1`, [{ source: url('race'), name: 'One' }])),
      save(otherAgent, `${PREFIX}race2`, project(`${PREFIX}race2`, [{ source: url('race'), name: 'Two' }]))
    ]);
    saved(r1);
    saved(r2);
    const docs = await ours();
    assert.lengthOf(docs, 1);
    assert.include(['One', 'Two'], docs[0].name);
  }).timeout(U.shortTimeout);

  describe('a datasets write that fails', function () {
    let spy;

    before(async function () {
      // every insert into datasets is refused
      await db().command({ collMod: 'datasets', validator: { source: { $type: 'int' } }, validationLevel: 'strict', validationAction: 'error' });
      spy = sinon.spy(log, 'error');
    });

    after(async function () {
      spy.restore();
      await db().command({ collMod: 'datasets', validator: {}, validationLevel: 'strict' });
    });

    it('still saves the project, and is logged', async function () {
      const shortname = `${PREFIX}fails`;
      saved(await save(ownerAgent, shortname, project(shortname, [{ source: url('fails'), name: 'Fails' }])));
      assert.deepEqual((await U.queryProject(shortname)).files.list, [{ source: url('fails'), name: 'Fails' }]);
      assert.deepEqual(await ours(), []);
      assert.isTrue(spy.calledWithMatch({ project: shortname }, 'cannot create the dataset documents of a project save'));
    }).timeout(U.shortTimeout);
  });
});
