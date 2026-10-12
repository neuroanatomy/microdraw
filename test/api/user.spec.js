'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// GET /user/json/:userName and the profile page GET /user/:userName are
// public: they must expose only public profile fields, and an unknown user
// must not take the server down. Assertions never print the body, so a
// failure cannot copy a hash into the test log.
const credentials = { username: 'api-user-json-user', password: 'user-json-password' };
const unknownUser = 'api-user-json-nobody';
const publicFields = ['username', 'name', 'avatarURL', 'url', 'joined'];

const get = (pathname) => chai.request(U.serverURL).get(pathname);

describe('Public user data (/user/json/:userName, /user/:userName)', function () {
  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.shortTimeout);
    const res = await chai.request(U.serverURL).post('/localSignup')
      .send(credentials);
    assert.equal(res.status, 200);
    // /localSignup answers before its insert has finished.
    await U.delay(500);
  });

  after(async function () {
    await U.removeLocalUser(credentials.username);
  });

  it('returns the public fields of a local user, without passhash (anonymous)', async function () {
    const res = await get(`/user/json/${credentials.username}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, credentials.username);
    assert.notProperty(res.body, 'passhash');
    assert.isFalse(res.text.includes('passhash'), 'body mentions passhash');
    assert.isFalse(res.text.includes('$2b$'), 'body contains a bcrypt hash');
    Object.keys(res.body).forEach((key) => assert.include(publicFields, key));
  }).timeout(U.shortTimeout);

  it('does not return the hash through ?var=passhash', async function () {
    const res = await get(`/user/json/${credentials.username}?var=passhash`);
    assert.isFalse(res.text.includes('$2b$'), 'body contains a bcrypt hash');
    assert.isNotOk(res.body && res.body.passhash);
  }).timeout(U.shortTimeout);

  it('does not return the hash through ?var=1/passhash', async function () {
    const res = await get(`/user/json/${credentials.username}?var=1/passhash`);
    assert.isFalse(res.text.includes('$2b$'), 'body contains a bcrypt hash');
  }).timeout(U.shortTimeout);

  it('answers an unknown user with 404 and a small JSON body', async function () {
    const res = await get(`/user/json/${unknownUser}`);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'User not found' });
  }).timeout(U.shortTimeout);

  it('keeps serving after an unknown user and a bad ?var=', async function () {
    await get(`/user/json/${unknownUser}`);
    await get(`/user/json/${credentials.username}?var=a/b`);
    const res = await get(`/user/json/${credentials.username}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, credentials.username);
  }).timeout(U.shortTimeout);

  it('serves the profile page (anonymous) without passhash or a bcrypt hash', async function () {
    const res = await get(`/user/${credentials.username}`);
    assert.equal(res.status, 200);
    assert.isFalse(res.text.includes('passhash'), 'body mentions passhash');
    assert.isFalse(res.text.includes('$2b$'), 'body contains a bcrypt hash');
  }).timeout(U.shortTimeout);

  it('embeds only public fields in the profile page userInfo', async function () {
    const res = await get(`/user/${credentials.username}`);
    const match = res.text.match(/const userInfo=(.*);\n/);
    assert.isNotNull(match, 'userInfo not found in the page');
    const userInfo = JSON.parse(match[1]);
    assert.equal(userInfo.username, credentials.username);
    Object.keys(userInfo).forEach((key) => assert.include(publicFields, key));
  }).timeout(U.shortTimeout);
});
