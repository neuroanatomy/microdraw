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

// All the names GET /user/json returns, following its pages.
const listAllUsers = async () => {
  const names = [];
  for (let page = 0; page < 100; page++) {
    // eslint-disable-next-line no-await-in-loop -- pages are read in order
    const res = await get(`/user/json?page=${page}`);
    assert.equal(res.status, 200);
    assert.isArray(res.body);
    assert.isAtMost(res.body.length, 20);
    names.push(...res.body);
    if (res.body.length < 20) {
      break;
    }
  }

  return names;
};

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

  describe('user routes fixed in M2', function () {
    // M2: ?var= used to index the path segments with their own values, so it
    // never returned the field it named.
    // M3: as JSON (it was text/html: a GitHub name holding markup was served
    // as an HTML page)
    it('?var=username returns the username, as JSON', async function () {
      const res = await get(`/user/json/${credentials.username}?var=username`);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.equal(JSON.parse(res.text), credentials.username);
    }).timeout(U.shortTimeout);

    // M2: GET /user/json called NWL queryAllUsers, which NWL's db.js does not
    // export (500 on every page). It lists usernames only, 20 per page, as
    // BrainBox's apiUserAll lists nicknames.
    it('GET /user/json?page= lists usernames only, 20 per page', async function () {
      const names = await listAllUsers();
      names.forEach((name) => assert.isString(name));
      assert.include(names, credentials.username);
      assert.isFalse(JSON.stringify(names).includes('$2b$'), 'list contains a bcrypt hash');
    }).timeout(U.shortTimeout);

    it('GET /user/json without a page answers an error message', async function () {
      const res = await get('/user/json');
      assert.property(res.body, 'error');
    }).timeout(U.shortTimeout);

    it('GET /user/json?page=<not a number> answers the first page', async function () {
      const res = await get('/user/json?page=abc');
      assert.equal(res.status, 200);
      assert.isArray(res.body);
    }).timeout(U.shortTimeout);
  });
});
