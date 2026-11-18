'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M1: the /project JSON routes accept an API token (?token=), as /api does
// and as BrainBox's project routes do. Requests here carry the token but no
// session cookie. Reads with a token, without one and with an unknown one are
// in NeuroWebLab's shared suite (slice 1, rules 1.11 and 1.12); this save
// sends its data as a JSON string.
const member = { username: 'api-token-member', password: 'token-member-password' };
const project = U.createProjectWithPermission('apitokenprivate', { files: 'edit', collaborators: 'view', annotations: 'view' });
project.collaborators.list[1].username = member.username;
project.collaborators.list[1].userID = member.username;
project.collaborators.list[1].name = member.username;

const noCookie = () => chai.request(U.serverURL);

describe('Token authentication on /project routes (M1)', function () {
  let token;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertProject(project);
    const agent = await U.logIn(member);
    const res = await agent.get('/token');
    ({ token } = res.body);
    assert.isNotEmpty(token);
  });

  after(async function () {
    await Promise.all([U.removeProject(project.shortname), U.removeLocalUser(member.username)]);
  });

  it('POST /project/json/:name saves with the token', async function () {
    const changed = { ...project, name: 'Changed through a token' };
    delete changed._id;
    const res = await noCookie().post(`/project/json/${project.shortname}`)
      .query({ token })
      .send({ data: JSON.stringify(changed) });
    assert.equal(res.status, 200);
    assert.isTrue(res.body.success);
    const saved = await U.queryProject(project.shortname);
    assert.equal(saved.name, 'Changed through a token');
  }).timeout(U.shortTimeout);

  // NeuroWebLab 1.21.0 (M14b): the routes take the visitor from NWL's
  // visitor(req), which a valid token sets and an expired one does not. The
  // project page does not read a token (no authTokenMiddleware on it, as in
  // BrainBox): there it is logged out.
  describe('the visitor of a token (NeuroWebLab 1.21.0 visitor)', function () {
    let expired;

    before(async function () {
      expired = `apitokenexpired${Date.now().toString(36)}`;
      await U.getNativeDB().collection('log')
        .insertOne({ token: expired, username: member.username, expiryDate: new Date(Date.now() - 60000) });
    });

    after(async function () {
      await U.getNativeDB().collection('log')
        .deleteMany({ token: expired });
    });

    it('a valid token on GET /project/json/:name is its user: the private project, 200', async function () {
      const res = await noCookie().get(`/project/json/${project.shortname}`)
        .query({ token });
      assert.equal(res.status, 200);
      assert.equal(res.body.shortname, project.shortname);
    }).timeout(U.shortTimeout);

    it('a valid token on POST /project/json/:name saves as its user (modifiedBy)', async function () {
      const current = await U.queryProject(project.shortname);
      const changed = { ...current, name: 'Changed by the token user' };
      delete changed._id;
      const res = await noCookie().post(`/project/json/${project.shortname}`)
        .query({ token })
        .send({ data: JSON.stringify(changed) });
      assert.equal(res.status, 200);
      const saved = await U.queryProject(project.shortname);
      assert.equal(saved.name, 'Changed by the token user');
      assert.equal(saved.modifiedBy, member.username);
    }).timeout(U.shortTimeout);

    it('a valid token on the project page is not read: logged out, 401', async function () {
      const res = await noCookie().get(`/project/${project.shortname}`)
        .query({ token });
      assert.equal(res.status, 401);
      assert.equal(res.text, 'Not authorized to view project');
    }).timeout(U.shortTimeout);

    it('an expired token is logged out: GET /project/json/:name 401, POST 401', async function () {
      const read = await noCookie().get(`/project/json/${project.shortname}`)
        .query({ token: expired });
      assert.equal(read.status, 401);
      assert.deepEqual(read.body, { error: 'Not authorized to view project' });
      const save = await noCookie().post(`/project/json/${project.shortname}`)
        .query({ token: expired })
        .send({ data: JSON.stringify({ ...project, name: 'Not saved' }) });
      assert.equal(save.status, 401);
      assert.deepEqual(save.body, { success: false, error: 'User not authenticated', message: 'User not authenticated' });
      assert.notEqual((await U.queryProject(project.shortname)).name, 'Not saved');
    }).timeout(U.shortTimeout);
  });
});
