'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

const _ = require('lodash');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// T002 3.1: the settings page loads its files in batches from
// /project/json/:p/files, as BrainBox's does. The page gets no files, a
// filesLoaded {count: 0} and filesTotal; a save says how many files the page
// had received (filesLoaded.count). If that is not the stored list's length,
// the list sent is incomplete and the stored one is kept; the rest of the
// save goes through. filesLoaded is never stored.
describe('Settings page files loaded in batches, incomplete lists kept (T002 3.1)', function () {
  const PREFIX = 'batchedfiles';
  const NFILES = 250;
  const owner = { username: 'batchedfiles-owner', password: 'batchedfiles-owner-password' };
  const friend = { username: 'batchedfiles-friend', password: 'batchedfiles-friend-password' };
  const editor = { username: 'batchedfiles-editor', password: 'batchedfiles-editor-password' };
  const files = Array.from({ length: NFILES }, (_v, i) => ({ source: `/test_data/${PREFIX}-${i}.dzi`, name: `file ${i}` }));
  const access = (filesLevel, annotations, collaborators) => ({ files: filesLevel, annotations, collaborators });
  let editorAgent, ownerAgent;

  const db = () => U.getNativeDB();
  const versions = (shortname) => db().collection('projects')
    .find({ shortname }, { sort: { _id: 1 } })
    .toArray();
  const project = (shortname) => ({
    name: `Batched ${shortname}`,
    shortname,
    url: '',
    created: '2026-11-14T00:00:00.000Z',
    owner: owner.username,
    collaborators: {
      list: [
        { username: 'anyone', userID: 'anyone', access: access('view', 'view', 'view') },
        // may save, and edit the files in place, but not add or remove any
        { username: editor.username, userID: editor.username, access: access('edit', 'view', 'view') }
      ]
    },
    files: { list: files.map((f) => ({ ...f })) },
    annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '', display: true }] }
  });
  const inlineValue = (html, name) => {
    const match = html.match(new RegExp(`const ${name}=(.*);\\n`));
    assert.exists(match, `no inline ${name}`);

    return JSON.parse(match[1]);
  };
  // the project as the settings page sends it back, after receiving `received` files
  const pageProject = async (agent, shortname, received) => {
    const res = await agent.get(`/project/${shortname}/settings`);
    assert.equal(res.status, 200);
    const info = inlineValue(res.text, 'project');
    const answer = await agent.get(`/project/json/${shortname}/files?start=0&length=${received}&names=true`);
    info.files.list = answer.body;
    info.filesLoaded.count = answer.body.length;

    return info;
  };
  const save = (agent, shortname, data) => agent.post(`/project/json/${shortname}`).send({ data });
  const fresh = async (tag) => {
    const shortname = `${PREFIX}${tag}`;
    await U.removeProject(shortname);
    await U.insertProject(project(shortname));

    return shortname;
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    ownerAgent = await U.logIn(owner);
    editorAgent = await U.logIn(editor);
    await U.signUp(friend);
  });

  after(async function () {
    await db().collection('projects')
      .deleteMany({ shortname: { $regex: `^${PREFIX}` } });
    await Promise.all([owner, friend, editor].map((u) => U.removeLocalUser(u.username)));
  });

  it('the settings page has no files, a filesLoaded count of 0 and the stored number of files', async function () {
    const shortname = await fresh('page');
    const res = await ownerAgent.get(`/project/${shortname}/settings`);
    assert.equal(res.status, 200);
    const info = inlineValue(res.text, 'project');
    assert.deepEqual(info.files.list, []);
    assert.deepEqual(info.filesLoaded, { count: 0 });
    assert.equal(inlineValue(res.text, 'filesTotal'), NFILES);
    assert.notInclude(res.text, `${PREFIX}-0.dzi`, 'a file is in the page');
  }).timeout(U.shortTimeout);

  it('the files route gives the names the settings table showed before', async function () {
    const shortname = await fresh('names');
    const res = await ownerAgent.get(`/project/json/${shortname}/files?start=0&length=${NFILES}&names=true`);
    assert.deepEqual(res.body, files);
  }).timeout(U.shortTimeout);

  it('a file stored as a string gets the name the settings page gave it (the text after the last /)', async function () {
    const shortname = `${PREFIX}strings`;
    await U.removeProject(shortname);
    await U.insertProject({ ...project(shortname), files: { list: ['http://strings.localhost/a/brain.dzi', '', 'plain'] } });
    const res = await ownerAgent.get(`/project/json/${shortname}/files?start=0&length=10&names=true`);
    assert.deepEqual(res.body, [
      { source: 'http://strings.localhost/a/brain.dzi', name: 'brain.dzi' },
      { source: '', name: '' },
      { source: 'plain', name: '' }
    ]);
  }).timeout(U.shortTimeout);

  it('a save with fewer files than stored keeps the stored files, and saves its other changes in a new version', async function () {
    const shortname = await fresh('partial');
    const info = await pageProject(ownerAgent, shortname, 100);
    info.collaborators.list.push({ username: friend.username, userID: friend.username, access: access('view', 'view', 'view') });
    info.annotations.list.push({ type: 'text', name: 'Notes', values: '', display: true });
    info.name = 'Renamed';
    const res = await save(ownerAgent, shortname, info);
    assert.equal(res.status, 200, res.text);
    assert.include(res.body.message, 'The list of files was not saved because it had not been completely loaded');
    assert.notInclude(res.body.message, 'were ignored');
    const docs = await versions(shortname);
    assert.lengthOf(docs, 2);
    assert.isTrue(docs[0].backup, 'the old version is a backup');
    const [, stored] = docs;
    assert.notProperty(stored, 'backup');
    assert.deepEqual(stored.files.list, files, 'the stored files are kept, in order');
    assert.equal(stored.name, 'Renamed');
    assert.include(stored.collaborators.list.map((c) => c.username), friend.username);
    assert.deepEqual(stored.annotations.list.map((a) => a.name), ['Layer', 'Notes']);
    assert.notProperty(stored, 'filesLoaded');
  }).timeout(U.shortTimeout);

  it('a save with fewer files than stored, by a user who may not remove files, is not reported as ignored', async function () {
    const shortname = await fresh('partialeditor');
    const info = await pageProject(editorAgent, shortname, 100);
    const res = await save(editorAgent, shortname, info);
    assert.equal(res.status, 200, res.text);
    assert.notInclude(res.body.message, 'were ignored');
    assert.include(res.body.message, 'had not been completely loaded');
    const stored = await U.queryProject(shortname);
    assert.deepEqual(stored.files.list, files);
  }).timeout(U.shortTimeout);

  it('a save with every file received replaces the list, as before', async function () {
    const shortname = await fresh('complete');
    const info = await pageProject(ownerAgent, shortname, NFILES);
    info.files.list.splice(10, 1);
    info.files.list[0].name = 'renamed 0';
    const res = await save(ownerAgent, shortname, info);
    assert.equal(res.status, 200, res.text);
    assert.notInclude(res.body.message, 'completely loaded');
    const stored = await U.queryProject(shortname);
    assert.lengthOf(stored.files.list, NFILES - 1);
    assert.equal(stored.files.list[0].name, 'renamed 0');
    assert.notInclude(stored.files.list.map((f) => f.source), files[10].source);
    assert.notProperty(stored, 'filesLoaded');
  }).timeout(U.shortTimeout);

  it('a save without filesLoaded takes its list as complete, as before', async function () {
    const shortname = await fresh('nocount');
    const info = _.omit(await pageProject(ownerAgent, shortname, 100), ['filesLoaded']);
    const res = await save(ownerAgent, shortname, info);
    assert.equal(res.status, 200, res.text);
    assert.notInclude(res.body.message, 'completely loaded');
    const stored = await U.queryProject(shortname);
    assert.deepEqual(stored.files.list, files.slice(0, 100));
    assert.notProperty(stored, 'filesLoaded');
  }).timeout(U.shortTimeout);

  it('a new project sent with filesLoaded is saved without it', async function () {
    const shortname = `${PREFIX}new`;
    await U.removeProject(shortname);
    const res = await save(ownerAgent, shortname, { ...project(shortname), filesLoaded: { count: 3 } });
    assert.equal(res.status, 200, res.text);
    const stored = await U.queryProject(shortname);
    assert.lengthOf(stored.files.list, NFILES);
    assert.notProperty(stored, 'filesLoaded');
  }).timeout(U.shortTimeout);
});
