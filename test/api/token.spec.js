'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');

// M1: the /project JSON routes accept an API token (?token=), as /api does
// and as BrainBox's project routes do. Requests here carry the token but no
// session cookie.
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
    const agent = chai.request.agent(U.getServer());
    await agent.post('/localSignup').send(member);
    // /localSignup answers before its insert has finished.
    await U.delay(500);
    let res = await agent.post('/localLogin').redirects(0)
      .send(member);
    expect(res).to.have.cookie('connect.sid');
    res = await agent.get('/token');
    ({ token } = res.body);
    assert.isNotEmpty(token);
  });

  after(async function () {
    await Promise.all([U.removeProject(project.shortname), U.removeLocalUser(member.username)]);
  });

  it('GET /project/json/:name gives a private project to its collaborator', async function () {
    const res = await noCookie().get(`/project/json/${project.shortname}`)
      .query({ token });
    assert.equal(res.status, 200);
    assert.equal(res.body.shortname, project.shortname);
  }).timeout(U.shortTimeout);

  it('GET /project/json/:name still refuses it without the token', async function () {
    const res = await noCookie().get(`/project/json/${project.shortname}`);
    assert.equal(res.status, 403);
  }).timeout(U.shortTimeout);

  it('GET /project/json/:name refuses it with an unknown token', async function () {
    const res = await noCookie().get(`/project/json/${project.shortname}`)
      .query({ token: 'not-a-token' });
    assert.equal(res.status, 403);
  }).timeout(U.shortTimeout);

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
});
