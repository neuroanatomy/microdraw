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
});
