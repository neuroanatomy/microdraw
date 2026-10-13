'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// P1 (NeuroWebLab 0.2.0, passport 0.7): the session is regenerated at login,
// with returnTo carried over by NWL, and req.user is reduced to
// {username, <usernameField>, name, avatarURL, url, joined}. microdraw reads
// only req.user.username; the pages render req.user as `loggedUser`.
// Logout and token auth after a logout: auth-session.spec.js (M5d).
const sessionFields = ['username', 'name', 'avatarURL', 'url', 'joined'];

const loggedUserOf = (res) => {
  const match = res.text.match(/const loggedUser=(.*);/);
  assert.isNotNull(match, 'the page renders loggedUser');

  return JSON.parse(match[1]);
};

const sessionCookie = (res) => (res.headers['set-cookie'] || [])
  .map((c) => c.split(';')[0])
  .find((c) => c.startsWith('connect.sid='));

describe('Login session with NeuroWebLab 0.2.0 (P1)', function () {
  const credentials = { username: 'p1-session-user', password: 'p1-session-password' };
  const project = U.createProjectWithPermission('p1sessionproject', { files: 'view' });
  project.collaborators.list[0].access.files = 'view';
  project.owner = credentials.username;

  before(async function () {
    await U.insertProject({ ...project });
  });

  after(async function () {
    await U.removeProject(project.shortname);
    await U.removeLocalUser(credentials.username);
  });

  // eslint-disable-next-line max-statements -- one scenario, step by step
  it('log in from a project page: back to that page, in a new session', async function () {
    await U.signUp(credentials);
    const agent = chai.request.agent(U.getServer());
    const page = await agent.get(`/project/${project.shortname}`);
    assert.equal(page.status, 200);
    const before = sessionCookie(page);
    assert.isString(before, 'visiting the page starts a session (returnTo)');

    const login = await agent.post('/localLogin').redirects(0)
      .send(credentials);
    assert.equal(login.status, 301);
    assert.equal(login.headers.location, `/project/${project.shortname}`);
    const after = sessionCookie(login);
    assert.isString(after);
    assert.notEqual(after, before, 'the login regenerates the session');

    assert.equal((await agent.get('/token')).status, 200);
    const old = await chai.request(U.serverURL).get('/token')
      .set('Cookie', before);
    assert.equal(old.status, 401, 'the pre-login session is not logged in');
  }).timeout(U.shortTimeout);

  it('logs out back to the last page visited, and the session ends', async function () {
    const agent = await U.logIn(credentials);
    await agent.get(`/user/${credentials.username}`);
    const res = await agent.get('/logout').redirects(0);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/user/${credentials.username}`);
    assert.equal((await agent.get('/token')).status, 401);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements -- one scenario, step by step
  it('pages render the reduced session user: menu, user page, settings, new project', async function () {
    const agent = await U.logIn(credentials);

    const projectPage = await agent.get(`/project/${project.shortname}`);
    assert.include(projectPage.text, `href='/user/${credentials.username}'>${credentials.username}</a>`);
    assert.include(projectPage.text, '/logout');

    for (const pathname of [
      `/user/${credentials.username}`,
      `/project/${project.shortname}/settings`,
      '/project/new'
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one page at a time
      const res = await agent.get(pathname);
      assert.equal(res.status, 200, pathname);
      const loggedUser = loggedUserOf(res);
      assert.equal(loggedUser.username, credentials.username, pathname);
      assert.includeMembers(sessionFields, Object.keys(loggedUser), pathname);
      assert.notInclude(res.text, 'passhash', pathname);
    }
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements -- one scenario, step by step
  it('a session stored in the old shape (whole user document) is read reduced', async function () {
    const agent = await U.logIn(credentials);
    const sessions = U.getDB().get('sessions');
    const stored = (await sessions.find({})).find((s) => {
      const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;

      return data.passport && data.passport.user && data.passport.user.username === credentials.username;
    });
    assert.exists(stored, 'the login stored a session');
    const data = typeof stored.session === 'string' ? JSON.parse(stored.session) : stored.session;
    // what NWL < 0.2.0 stored for a local login: the whole user document
    data.passport.user = {
      ...data.passport.user,
      passhash: '$2b$10$abcdefghijklmnopqrstuuJ0x1Wf5sYwV5ZbY8iY0Hn6Q8w3m2p6',
      _json: { login: credentials.username },
      photos: [{ value: 'x' }]
    };
    await sessions.update({ _id: stored._id }, {
      $set: { session: typeof stored.session === 'string' ? JSON.stringify(data) : data }
    }, { castIds: false }); // session ids are strings, not ObjectIds
    const rewritten = await sessions.findOne({ _id: stored._id }, { castIds: false });
    assert.include(JSON.stringify(rewritten.session), 'passhash', 'the stored session has the old shape');

    const res = await agent.get(`/user/${credentials.username}`);
    const loggedUser = loggedUserOf(res);
    assert.equal(loggedUser.username, credentials.username, 'still logged in');
    assert.includeMembers(sessionFields, Object.keys(loggedUser));
    assert.notInclude(res.text, 'passhash');
    assert.equal((await agent.get('/token')).status, 200);
  }).timeout(U.shortTimeout);
});
