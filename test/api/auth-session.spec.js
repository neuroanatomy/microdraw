'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M5d: login is NeuroWebLab's (passport 0.4, GitHub and local strategies);
// microdraw itself doesn't require passport. These tests prove that logout,
// the GitHub route wiring and token auth keep working when microdraw's own
// passport dependency is removed. Recorded on passport 0.4.1 (2026-10-13).
describe('Login session, logout, GitHub routes and token (M5d)', function () {
  const credentials = { username: 'm5d-auth-user', password: 'm5d-auth-password' };
  const project = U.createProjectWithPermission('m5dauthprivate', { files: 'none' });
  project.owner = credentials.username;

  before(async function () {
    await U.insertProject(project);
  });

  after(async function () {
    await U.removeProject(project.shortname);
    await U.removeLocalUser(credentials.username);
  });

  it('logs out: /logout redirects to / and ends the session', async function () {
    const agent = await U.logIn(credentials);
    assert.equal((await agent.get('/token')).status, 200);
    const res = await agent.get('/logout').redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    assert.equal((await agent.get('/token')).status, 401, 'still logged in after /logout');
  }).timeout(U.shortTimeout);

  it('a token still authenticates after the session that made it logged out', async function () {
    const agent = await U.logIn(credentials);
    const { token } = (await agent.get('/token')).body;
    await agent.get('/logout').redirects(0);
    const res = await chai.request(U.serverURL).get(`/project/json/${project.shortname}`)
      .query({ token });
    assert.equal(res.status, 200);
    assert.equal(res.body.shortname, project.shortname);
    const anonymous = await chai.request(U.serverURL).get(`/project/json/${project.shortname}`);
    assert.notEqual(anonymous.status, 200);
  }).timeout(U.shortTimeout);

  it('GET /auth/github redirects to the GitHub authorize page', async function () {
    const res = await chai.request(U.serverURL).get('/auth/github')
      .redirects(0);
    assert.equal(res.status, 302);
    const location = new URL(res.headers.location);
    assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(location.searchParams.get('response_type'), 'code');
    assert.isNotEmpty(location.searchParams.get('client_id'));
  }).timeout(U.shortTimeout);

  it('GET /auth/github/callback with a refusal redirects to / (failureRedirect)', async function () {
    const res = await chai.request(U.serverURL).get('/auth/github/callback')
      .query({ error: 'access_denied' })
      .redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    chai.expect(res).not.to.have.cookie('connect.sid');
  }).timeout(U.shortTimeout);

  it('GET /auth/github/callback without a code starts the GitHub login again', async function () {
    const res = await chai.request(U.serverURL).get('/auth/github/callback')
      .redirects(0);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  }).timeout(U.shortTimeout);
});
