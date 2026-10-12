'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');

// M1: GET /user/json/:userName/projects lists the projects the visitor may
// view, and inside each one only what GET /project/json/:name would show:
// collaborators and annotations are hidden unless the visitor may view them.
const member = { username: 'api-access-user-member', password: 'access-user-password' };

// files are public; collaborators and annotations are not
const project = U.createProjectWithPermission('apiaccessuserfiles', { files: 'view', collaborators: 'view', annotations: 'view' });
project.collaborators.list[0].access = { collaborators: 'none', annotations: 'none', files: 'view' };
project.collaborators.list[1].username = member.username;
project.collaborators.list[1].userID = member.username;
project.collaborators.list[1].name = member.username;

const findProject = (res) => {
  assert.equal(res.status, 200);
  assert.isTrue(res.body.successful);
  const found = res.body.list.find((p) => p.shortname === project.shortname);
  assert.exists(found, `${project.shortname} not listed`);

  return found;
};

describe('Route access checks: user projects (M1)', function () {
  let agent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertProject(project);
    agent = chai.request.agent(U.getServer());
    await agent.post('/localSignup').send(member);
    // /localSignup answers before its insert has finished.
    await U.delay(500);
    const res = await agent.post('/localLogin').redirects(0)
      .send(member);
    expect(res).to.have.cookie('connect.sid');
  });

  after(async function () {
    await Promise.all([U.removeProject(project.shortname), U.removeLocalUser(member.username)]);
  });

  it('hides collaborators and annotations an anonymous visitor may not view', async function () {
    const found = findProject(await chai.request(U.serverURL).get(`/user/json/${member.username}/projects`));
    assert.deepEqual(found.files.list, project.files.list);
    assert.deepEqual(found.collaborators.list.map((c) => c.username), ['anyone']);
    assert.isFalse(JSON.stringify(found).includes(member.username), 'the member is listed');
    assert.deepEqual(found.annotations.list, []);
  }).timeout(U.shortTimeout);

  it('shows them to a collaborator who may view them', async function () {
    const found = findProject(await agent.get(`/user/json/${member.username}/projects`));
    assert.deepEqual(found.collaborators.list.map((c) => c.username), ['anyone', member.username]);
    assert.deepEqual(found.annotations.list, project.annotations.list);
  }).timeout(U.shortTimeout);
});
