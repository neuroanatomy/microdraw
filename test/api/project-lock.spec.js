/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');
const lock = require('../../app/controller/projectLock');
const adminAnnotations = require('../../app/controller/admin/admin.annotations');

// M3 (T002 steps 1.4, 1.5): one lock per project around the changes to a
// project (settings save, delete, admin assign), as BrainBox's projectLock;
// deleting a project marks its annotations as backups (decisions D28).
const owner = { username: 'm3b-owner', password: 'm3b-owner-password' };
const stranger = { username: 'm3b-stranger', password: 'm3b-stranger-password' };

const login = async (credentials) => {
  const agent = chai.request.agent(U.getServer());
  await agent.post('/localSignup').send(credentials);
  // /localSignup answers before its insert has finished.
  await U.delay(500);
  const res = await agent.post('/localLogin').redirects(0)
    .send(credentials);
  expect(res).to.have.cookie('connect.sid');

  return agent;
};

const project = (shortname, sources = ['/test_data/cat.json']) => ({
  name: `M3b ${shortname}`,
  shortname,
  url: '',
  owner: owner.username,
  collaborators: { list: [{ username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'view', files: 'view' } }] },
  files: { list: sources.map((source) => ({ source, name: source.split('/').pop() })) },
  annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set 1', display: true }] }
});

const region = (fileID, projectName, n, extra = {}) => ({
  fileID,
  user: owner.username,
  project: projectName,
  Hash: 'h',
  annotation: { name: `r${n}`, uid: `m3buid${n}`, path: ['Path', { segments: [[0, 0], [1, 1], [2, 0]], closed: true }] },
  ...extra
});

// Resolves after `ms`, or with the value of `promise` if it settles first.
const settledWithin = (promise, ms) => Promise.race([
  promise.then(() => 'settled', () => 'settled'),
  new Promise((resolve) => { setTimeout(() => resolve('pending'), ms); })
]);

// eslint-disable-next-line max-statements
describe('Project lock and project deletion (M3)', function () {
  let agent, strangerAgent;
  const shortnames = ['m3bconcurrent', 'm3bwait', 'm3bdelete', 'm3bkeep', 'm3bassign', 'm3bnoremove'];

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    agent = await login(owner);
    strangerAgent = await login(stranger);
  });

  after(async function () {
    await Promise.all([
      ...shortnames.map((s) => U.removeProject(s)),
      ...shortnames.map((s) => U.removeProjectAnnotations(s)),
      U.getDB().get('annotations')
        .remove({ fileID: /^m3b-/ }),
      U.getDB().get('log')
        .remove({ 'value.shortname': { $in: shortnames } }),
      U.removeLocalUser(owner.username),
      U.removeLocalUser(stranger.username)
    ]);
  });

  describe('the lock', function () {
    it('runs the holders of a key one after the other, in order', async function () {
      const order = [];
      const work = (name, ms) => lock.acquire('m3b-test', async () => {
        order.push(`${name} in`);
        await U.delay(ms);
        order.push(`${name} out`);

        return name;
      });
      const results = await Promise.all([work('a', 30), work('b', 1), work('c', 1)]);
      assert.deepEqual(results, ['a', 'b', 'c']);
      assert.deepEqual(order, ['a in', 'a out', 'b in', 'b out', 'c in', 'c out']);
      assert.isFalse(lock.isProjectLocked('m3b-test'));
    });

    it('is released when the holder throws', async function () {
      let caught;
      try {
        await lock.withProjectLock('m3bthrow', () => { throw new Error('boom'); });
      } catch (err) {
        caught = err;
      }
      assert.equal(caught.message, 'boom');
      assert.isFalse(lock.isProjectLocked('m3bthrow'));
      assert.equal(await lock.withProjectLock('m3bthrow', () => 'next'), 'next');
    });

    it('does not make different projects wait for each other', async function () {
      let release;
      const held = lock.withProjectLock('m3bone', () => new Promise((resolve) => { release = resolve; }));
      assert.equal(await lock.withProjectLock('m3btwo', () => 'other'), 'other');
      release();
      await held;
    });
  });

  describe('saving a project', function () {
    it('concurrent creations of the same project store one document', async function () {
      const shortname = 'm3bconcurrent';
      const posts = [];
      for (let i = 0; i < 6; i += 1) {
        posts.push(agent.post(`/project/json/${shortname}`).send({ data: { ...project(shortname), name: `try ${i}` } }));
      }
      const results = await Promise.all(posts);
      results.forEach((res) => assert.equal(res.status, 200, res.text));
      const docs = await U.getDB().get('projects')
        .find({ shortname });
      assert.lengthOf(docs, 1);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('waits while another change of the same project holds the lock', async function () {
      const shortname = 'm3bwait';
      await U.insertProject(project(shortname));
      let release;
      const held = lock.withProjectLock(shortname, () => new Promise((resolve) => { release = resolve; }));
      const save = agent.post(`/project/json/${shortname}`).send({ data: { ...project(shortname), name: 'saved after' } })
        .then((res) => res);
      assert.equal(await settledWithin(save, 300), 'pending');
      assert.equal((await U.queryProject(shortname)).name, project(shortname).name);
      release();
      await held;
      const res = await save;
      assert.equal(res.status, 200, res.text);
      assert.equal((await U.queryProject(shortname)).name, 'saved after');
    }).timeout(U.shortTimeout);
  });

  // eslint-disable-next-line max-statements
  describe('deleting a project', function () {
    const img = 'm3b-img.dzi';
    const fileID = `${img}&slice=0`;

    // eslint-disable-next-line max-statements
    it('marks its annotations as backups, logs the project, keeps other projects\' annotations', async function () {
      await U.insertProject(project('m3bdelete', [img]));
      await U.insertProject(project('m3bkeep', [img]));
      await U.insertAnnotations([
        region(fileID, 'm3bdelete', 1),
        region(fileID, 'm3bdelete', 2),
        region(fileID, 'm3bdelete', 3, { backup: true }),
        region(fileID, 'm3bkeep', 4)
      ]);

      const res = await agent.delete('/project/json/m3bdelete');
      assert.equal(res.status, 200, res.text);
      assert.isTrue(res.body.success);
      assert.isNull(await U.queryProject('m3bdelete'));

      assert.lengthOf(await U.findAnnotations({ project: 'm3bdelete' }), 0);
      const marked = await U.getDB().get('annotations')
        .find({ project: 'm3bdelete', deletedWithProject: res.body.log });
      assert.lengthOf(marked, 2, 'the two current documents, not the older backup');
      marked.forEach((doc) => assert.isTrue(doc.backup));
      assert.lengthOf(await U.findAnnotations({ project: 'm3bkeep' }), 1);

      const entry = await U.getDB().get('log')
        .findOne({ key: 'deleteProject', 'value.shortname': 'm3bdelete' });
      assert.equal(String(entry._id), res.body.log);
      assert.equal(entry.value.username, owner.username);
      assert.equal(entry.value.annotations, 2);
      assert.equal(entry.value.project.name, 'M3b m3bdelete');

      // the viewer no longer gets them, and they are not orphans for the admin page
      const viewer = await agent.get('/api').query({ source: img, slice: 0, project: 'm3bdelete' });
      assert.notEqual(viewer.status, 200);
      const orphans = await adminAnnotations.findOrphanAnnotations(U.getDB(), { source: img });
      assert.lengthOf(orphans.list, 0);
    }).timeout(U.shortTimeout);

    it('a user without remove rights cannot delete, and the annotations stay', async function () {
      await U.insertProject(project('m3bnoremove', [img]));
      await U.insertAnnotations([region(fileID, 'm3bnoremove', 5)]);
      const res = await strangerAgent.delete('/project/json/m3bnoremove');
      assert.equal(res.status, 403);
      assert.lengthOf(await U.findAnnotations({ project: 'm3bnoremove' }), 1);
    }).timeout(U.shortTimeout);

    it('anonymous deletes answer 401 JSON, and a missing project 404', async function () {
      let res = await chai.request(U.serverURL).delete('/project/json/m3bkeep');
      assert.equal(res.status, 401);
      assert.match(res.headers['content-type'], /^application\/json/);
      res = await agent.delete('/project/json/m3bnosuchproject');
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('admin assign (A1)', function () {
    // eslint-disable-next-line max-statements
    it('waits for the target project\'s lock', async function () {
      const img = 'm3b-assign.dzi';
      await U.insertProject(project('m3bassign', [img]));
      await U.insertAnnotations([region(`${img}&slice=0`, '', 6)]);
      let release;
      const held = lock.withProjectLock('m3bassign', () => new Promise((resolve) => { release = resolve; }));
      const assign = adminAnnotations.assignOrphans(U.getDB(), {
        group: { fileID: `${img}&slice=0`, user: owner.username, project: '' },
        target: 'm3bassign',
        username: 'm3b-admin'
      });
      assert.equal(await settledWithin(assign, 300), 'pending');
      release();
      await held;
      const result = await assign;
      assert.equal(result.assigned, 1);
      await U.getDB().get('log')
        .remove({ key: 'adminAssignOrphans', 'value.to': 'm3bassign' });
    }).timeout(U.shortTimeout);
  });
});
