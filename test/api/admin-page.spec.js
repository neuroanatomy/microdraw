'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');

// A1: who may open the admin page. The JSON routes are in admin.spec.js, the
// page's behaviour in test/e2e/admin-page.spec.js.
// eslint-disable-next-line max-statements
describe('Admin page access (A1)', function () {
  const admin = { username: 'a1-page-admin', password: 'a1-page-admin-password' };
  const other = { username: 'a1-page-other', password: 'a1-page-other-password' };
  const tokens = {};
  const agents = {};
  let previousAdmins;

  const login = async (user) => {
    await chai.request(U.serverURL).post('/localSignup')
      .send(user);
    const agent = chai.request.agent(U.getServer());
    await agent.post('/localLogin').redirects(0)
      .send(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    agents[user.username] = agent;
    tokens[user.username] = token;
  };

  const get = (user) => chai.request(U.serverURL).get('/admin')
    .query({ token: tokens[user.username] });

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    await Promise.all([admin, other].map(login));
    previousAdmins = admins.getAdmins();
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await Promise.all([admin, other].map((u) => U.removeLocalUser(u.username)));
  });

  it('asks anonymous visitors to log in (401)', async function () {
    const res = await chai.request(U.serverURL).get('/admin');
    assert.equal(res.status, 401);
    assert.include(res.text, 'use the admin tools');
    assert.notInclude(res.text, 'admin-page.js');
  }).timeout(U.shortTimeout);

  it('refuses users who are not admins (403), with a token or a session', async function () {
    const res = await get(other);
    assert.equal(res.status, 403);
    assert.notInclude(res.text, 'admin-page.js');
    const session = await agents[other.username].get('/admin');
    assert.equal(session.status, 403);
  }).timeout(U.shortTimeout);

  it('shows the page to admins, with a token or a session', async function () {
    const res = await get(admin);
    assert.equal(res.status, 200);
    assert.include(res.text, '/js/pages/admin-page.js');
    const session = await agents[admin.username].get('/admin');
    assert.equal(session.status, 200);
    assert.include(session.text, '/js/pages/admin-page.js');
  }).timeout(U.shortTimeout);
});
