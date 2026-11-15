'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const _ = require('lodash');
const U = require('../mocha.test.util');

// The save of an existing project by per-list rights (2026-11-15): edit on at
// least one list lets a user save; each list's changes need that list's rights
// (add, remove, edit); the project's own fields (name, description, url...)
// need files edit. Before, every save needed files edit.
const PREFIX = 'saverights';
const owner = { username: 'save-rights-owner', password: 'save-rights-owner-password' };
const users = {
  annotationsAdd: { username: 'save-rights-ann-add', password: 'save-rights-ann-add-password' },
  annotationsEdit: { username: 'save-rights-ann-edit', password: 'save-rights-ann-edit-password' },
  annotationsRemove: { username: 'save-rights-ann-remove', password: 'save-rights-ann-remove-password' },
  collaboratorsAdd: { username: 'save-rights-col-add', password: 'save-rights-col-add-password' },
  viewer: { username: 'save-rights-viewer', password: 'save-rights-viewer-password' },
  filesEdit: { username: 'save-rights-files-edit', password: 'save-rights-files-edit-password' },
  squirrel: { username: 'save-rights-squirrel', password: 'save-rights-squirrel-password' }
};
const newcomer = { username: 'save-rights-newcomer', name: 'Newcomer' };

const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });
const levels = {
  annotationsAdd: access('view', 'add', 'view'),
  annotationsEdit: access('view', 'edit', 'view'),
  annotationsRemove: access('view', 'remove', 'view'),
  collaboratorsAdd: access('view', 'view', 'add'),
  viewer: access('view', 'view', 'view'),
  filesEdit: access('edit', 'view', 'view'),
  // the maintainer's rights in squirrelmonkey
  squirrel: access('view', 'remove', 'remove')
};

const row = (username, a) => ({ username, userID: username, name: username, access: a });

const project = (shortname) => ({
  name: `Save rights ${shortname}`,
  shortname,
  url: '',
  description: 'Stored description',
  created: '2026-11-15T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      row('anyone', access('none', 'none', 'none')),
      ...Object.keys(users).map((key) => row(users[key].username, levels[key]))
    ]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '10regions.json' }] }
});

const layer = (name) => ({ type: 'vectorial', name, values: '10regions.json' });

describe('Project save by per-list rights (2026-11-15)', function () {
  const agents = {};
  let count = 0;

  // A fresh project; returns its shortname and the document as the settings
  // page sends it back
  const fresh = async () => {
    count += 1;
    const shortname = `${PREFIX}${count}`;
    await U.insertProject(project(shortname));

    return { shortname, doc: _.omit(project(shortname), ['owner']) };
  };
  const save = (key, shortname, doc) => agents[key].post(`/project/json/${shortname}`).send({ data: doc });
  const layerNames = (p) => p.annotations.list.map((a) => a.name);

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.longTimeout);
    await U.getDB().collection('projects')
      .deleteMany({ shortname: { $regex: `^${PREFIX}` } });
    await U.insertUser({ ...newcomer });
    for (const key of Object.keys(users)) {
      // eslint-disable-next-line no-await-in-loop
      agents[key] = await U.logIn(users[key]);
    }
  });

  after(async function () {
    await Promise.all([
      U.getDB().collection('projects')
        .deleteMany({ shortname: { $regex: `^${PREFIX}` } }),
      U.removeLocalUser(newcomer.username),
      ...Object.values(users).map((u) => U.removeLocalUser(u.username))
    ]);
  });

  it('annotations add: a layer added is saved', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list.push(layer('Added'));
    const res = await save('annotationsAdd', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.notMatch(res.body.message, /ignored/);
    assert.deepEqual(layerNames(await U.queryProject(shortname)), ['Layer', 'Added']);
  }).timeout(U.shortTimeout);

  it('annotations edit: a layer renamed is saved', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list[0].name = 'Renamed';
    const res = await save('annotationsEdit', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.notMatch(res.body.message, /ignored/);
    assert.deepEqual(layerNames(await U.queryProject(shortname)), ['Renamed']);
  }).timeout(U.shortTimeout);

  it('annotations edit: a layer added is ignored and reported', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list.push(layer('Added'));
    const res = await save('annotationsEdit', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.match(res.body.message, /Some changes \(on annotations\) were ignored/);
    assert.deepEqual(layerNames(await U.queryProject(shortname)), ['Layer']);
  }).timeout(U.shortTimeout);

  it('annotations remove: a layer deleted is saved', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list = [];
    const res = await save('annotationsRemove', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(layerNames(await U.queryProject(shortname)), []);
  }).timeout(U.shortTimeout);

  it('collaborators add: a collaborator added is saved', async function () {
    const { shortname, doc } = await fresh();
    doc.collaborators.list.push(row(newcomer.username, access('view', 'view', 'view')));
    const res = await save('collaboratorsAdd', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.include((await U.queryProject(shortname)).collaborators.list.map((c) => c.username), newcomer.username);
  }).timeout(U.shortTimeout);

  it('without files edit: the name, description and url changed are ignored and reported, the lists saved', async function () {
    const { shortname, doc } = await fresh();
    doc.name = 'Renamed project';
    doc.description = 'Changed';
    doc.url = 'https://example.org';
    doc.extra = 'not stored before';
    doc.annotations.list.push(layer('Added'));
    const res = await save('annotationsAdd', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.match(res.body.message, /Some changes \(on name, url, description, extra\) were ignored/);
    const stored = await U.queryProject(shortname);
    assert.equal(stored.name, `Save rights ${shortname}`);
    assert.equal(stored.description, 'Stored description');
    assert.equal(stored.url, '');
    assert.notProperty(stored, 'extra');
    assert.deepEqual(layerNames(stored), ['Layer', 'Added']);
  }).timeout(U.shortTimeout);

  it('without files edit: a project field sent empty that the stored project lacks is not reported', async function () {
    const { shortname, doc } = await fresh();
    await U.getDB().collection('projects')
      .updateOne({ shortname }, { $unset: { url: '' } });
    doc.url = '';
    doc.annotations.list[0].name = 'Renamed';
    const res = await save('annotationsEdit', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.notMatch(res.body.message, /ignored/);
  }).timeout(U.shortTimeout);

  it('view everywhere: 403, with the reason in error and in message, nothing changes', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list.push(layer('Added'));
    const res = await save('viewer', shortname, doc);
    assert.equal(res.status, 403);
    assert.isFalse(res.body.success);
    assert.match(res.body.error, /edit rights/);
    assert.notEqual(res.body.error, 'error');
    assert.equal(res.body.message, res.body.error);
    assert.deepEqual(layerNames(await U.queryProject(shortname)), ['Layer']);
  }).timeout(U.shortTimeout);

  it('files edit: the name and a file are saved, a layer added is ignored (as before)', async function () {
    const { shortname, doc } = await fresh();
    doc.name = 'Renamed project';
    doc.files.list[0].name = 'renamed cat';
    doc.annotations.list.push(layer('Added'));
    const res = await save('filesEdit', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.match(res.body.message, /Some changes \(on annotations\) were ignored/);
    const stored = await U.queryProject(shortname);
    assert.equal(stored.name, 'Renamed project');
    assert.equal(stored.files.list[0].name, 'renamed cat');
    assert.deepEqual(layerNames(stored), ['Layer']);
  }).timeout(U.shortTimeout);

  it('squirrelmonkey: files view, annotations and collaborators remove, a vectorial layer Cortex is saved', async function () {
    const { shortname, doc } = await fresh();
    doc.annotations.list.push({ name: 'Cortex', type: 'vectorial', values: '10regions.json' });
    const res = await save('squirrel', shortname, doc);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.message, 'Project settings updated.');
    const stored = await U.queryProject(shortname);
    assert.deepInclude(stored.annotations.list, { name: 'Cortex', type: 'vectorial', values: '10regions.json' });
  }).timeout(U.shortTimeout);

  it('a new project is still created by any logged-in user', async function () {
    count += 1;
    const shortname = `${PREFIX}${count}`;
    const res = await save('viewer', shortname, _.omit(project(shortname), ['owner']));
    assert.equal(res.status, 200, res.text);
    assert.equal((await U.queryProject(shortname)).owner, users.viewer.username);
  }).timeout(U.shortTimeout);
});
