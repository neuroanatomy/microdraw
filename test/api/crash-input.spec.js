'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');

// M2: single requests (missing project, malformed body, missing upload) that
// used to throw inside an async Express handler. On Node >= 15 such an
// unhandled rejection ends the process. Each must get a clean error answer,
// and the server must keep serving afterwards.
const member = { username: 'api-crash-input-member', password: 'crash-input-password' };
const ownedProject = U.createProjectWithPermission('apicrashinputowned', { files: 'view' });
ownedProject.owner = member.username;
// public files, so that assertStillServing can read it anonymously
ownedProject.collaborators.list[0].access.files = 'view';
const missingProject = 'apicrashinputmissing';
const source = 'api-crash-input-source';

// A hung request fails the test instead of the run.
const timeout = 3000;

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

const assertStillServing = async () => {
  const res = await chai.request(U.serverURL).get(`/project/json/${ownedProject.shortname}`)
    .timeout(timeout);
  assert.equal(res.status, 200);
  assert.equal(res.body.shortname, ownedProject.shortname);
};

describe('Single requests that must not crash the server (M2)', function () {
  let agent, token;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertProject({ ...ownedProject });
    agent = await login(member);
    ({ token } = (await agent.get('/token')).body);
    assert.isNotEmpty(token);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(ownedProject.shortname),
      U.removeProject(missingProject),
      U.removeAnnotations(source),
      U.removeLocalUser(member.username)
    ]);
  });

  describe('DELETE /project/json/:projectName', function () {
    it('a missing project answers 404 (logged in)', async function () {
      const res = await agent.delete(`/project/json/${missingProject}`)
        .timeout(timeout);
      assert.equal(res.status, 404);
      assert.isFalse(res.body.success);
      await assertStillServing();
    }).timeout(U.shortTimeout);
  });

  describe('POST /project/json/:projectName', function () {
    it('malformed JSON in data answers 400 (logged in)', async function () {
      const res = await agent.post(`/project/json/${missingProject}`)
        .send({ data: '{"shortname": "' })
        .timeout(timeout);
      assert.equal(res.status, 400);
      await assertStillServing();
      assert.isNull(await U.queryProject(missingProject));
    }).timeout(U.shortTimeout);

    it('a body without data answers 400 (logged in)', async function () {
      const res = await agent.post(`/project/json/${missingProject}`)
        .send({})
        .timeout(timeout);
      assert.equal(res.status, 400);
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('a project without lists, over an existing one, answers an error and changes nothing', async function () {
      const res = await agent.post(`/project/json/${ownedProject.shortname}`)
        .send({ data: JSON.stringify({ shortname: ownedProject.shortname, name: 'changed' }) })
        .timeout(timeout);
      assert.isAtLeast(res.status, 400);
      await assertStillServing();
      const stored = await U.queryProject(ownedProject.shortname);
      assert.equal(stored.name, ownedProject.name);
    }).timeout(U.shortTimeout);
  });

  describe('POST /api (save from the GUI)', function () {
    it('a missing project answers 404 (anonymous)', async function () {
      const res = await chai.request(U.serverURL).post('/api')
        .send({
          action: 'save',
          source,
          slice: 0,
          project: missingProject,
          Hash: 'abc',
          annotation: JSON.stringify({ Regions: [] })
        })
        .timeout(timeout);
      assert.equal(res.status, 404);
      await assertStillServing();
    }).timeout(U.shortTimeout);
  });

  describe('POST /api/upload (save from the API)', function () {
    const upload = () => chai.request(U.serverURL).post('/api/upload')
      .query({ action: 'save', source, slice: 0, project: '', token });

    it('an upload without a file answers 400', async function () {
      const res = await upload().timeout(timeout);
      assert.equal(res.status, 400);
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('a file that is not JSON answers 400', async function () {
      const res = await upload().attach('data', Buffer.from('not json'), 'annotation.json')
        .timeout(timeout);
      assert.equal(res.status, 400);
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('an upload to a missing project answers 404', async function () {
      const region = { annotation: { name: 'r', path: ['Path', { segments: [[1, 2], [3, 4], [5, 2]], closed: true }] } };
      const res = await chai.request(U.serverURL).post('/api/upload')
        .query({ action: 'save', source, slice: 0, project: missingProject, token })
        .attach('data', Buffer.from(JSON.stringify([region])), 'annotation.json')
        .timeout(timeout);
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);

    it('a JSON file that is not a list of annotations answers 4xx', async function () {
      const res = await upload().attach('data', Buffer.from('[{"no": "annotation"}]'), 'annotation.json')
        .timeout(timeout);
      // 401 since before M2 (jsonIsValid); the status code is M3's to revisit
      assert.isAtLeast(res.status, 400);
      assert.isBelow(res.status, 500);
      await assertStillServing();
    }).timeout(U.shortTimeout);
  });
});
