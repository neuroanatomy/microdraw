'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// Local login and API tokens, against the real server and test database.
describe('Local login and tokens', function () {
  const credentials = { username: 'api-auth-user', password: 'correct-password' };

  before(async function () {
    const res = await U.signUp(credentials);
    assert.equal(res.status, 200);
  });

  // P2: NWL 0.2.0 answers /localSignup only once the user is stored, so the
  // test helpers no longer poll for it.
  // eslint-disable-next-line max-statements -- one scenario, step by step
  it('/localSignup answers 200 once the user is stored; again, 409', async function () {
    const user = { username: 'p2-signup-user', password: 'p2-password' };
    try {
      const res = await chai.request(U.serverURL).post('/localSignup')
        .send(user);
      assert.equal(res.status, 200);
      assert.exists(await U.getDB().get('users')
        .findOne({ username: user.username }), 'stored when the answer came');
      const again = await chai.request(U.serverURL).post('/localSignup')
        .send(user);
      assert.equal(again.status, 409);
      assert.equal((await U.signUp(user)).status, 409, 'U.signUp accepts an existing user');
      const agent = await U.logIn(user);
      assert.equal((await agent.get('/token')).status, 200);
    } finally {
      await U.removeLocalUser(user.username);
    }
  }).timeout(U.shortTimeout);

  after(async function () {
    await U.removeLocalUser(credentials.username);
  });

  it('logs in with the right password and gets a token', async function () {
    const agent = chai.request.agent(U.getServer());
    const res = await agent.post('/localLogin').redirects(0)
      .send(credentials);
    assert.equal(res.status, 301);
    chai.expect(res).to.have.cookie('connect.sid');
    const tokenRes = await agent.get('/token');
    assert.equal(tokenRes.status, 200);
    assert.equal(tokenRes.body.username, credentials.username);
    assert.isNotEmpty(tokenRes.body.token);
  }).timeout(U.shortTimeout);

  it('rejects a wrong password: no session, and /token is refused', async function () {
    const agent = chai.request.agent(U.getServer());
    const res = await agent.post('/localLogin').redirects(0)
      .send({ username: credentials.username, password: 'wrong-password' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/html/localsignin.html');
    chai.expect(res).not.to.have.cookie('connect.sid');
    const tokenRes = await agent.get('/token');
    assert.equal(tokenRes.status, 401);
  }).timeout(U.shortTimeout);

  it('rejects an unknown user: no session, and /token is refused', async function () {
    const agent = chai.request.agent(U.getServer());
    const res = await agent.post('/localLogin').redirects(0)
      .send({ username: 'api-auth-nobody', password: 'anything' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/html/localsignin.html');
    chai.expect(res).not.to.have.cookie('connect.sid');
    const tokenRes = await agent.get('/token');
    assert.equal(tokenRes.status, 401);
  }).timeout(U.shortTimeout);

  it('refuses GET /token without a session', async function () {
    const res = await chai.request(U.serverURL).get('/token');
    assert.equal(res.status, 401);
    assert.notProperty(res.body, 'token');
  }).timeout(U.shortTimeout);
});
