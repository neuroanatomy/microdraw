'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');

// M1: the project list and the searches only return what the requester may
// see. A private project is listed for its collaborators and owner, never for
// an anonymous visitor or a logged-in stranger. User search returns public
// fields only (T004 allow-list).
const collaborator = { username: 'api-access-collab', password: 'access-collab-password' };
const stranger = { username: 'api-access-stranger', password: 'access-stranger-password' };

const publicProject = U.createProjectWithPermission('apiaccesspublic', { files: 'view' });
publicProject.collaborators.list[0].access.files = 'view';
const privateProject = U.createProjectWithPermission('apiaccessprivate', { files: 'view' });
const ownedProject = U.createProjectWithPermission('apiaccessowned', {});
ownedProject.owner = collaborator.username;
[publicProject, privateProject, ownedProject].forEach((project) => {
  project.collaborators.list[1].username = collaborator.username;
  project.collaborators.list[1].userID = collaborator.username;
  project.collaborators.list[1].name = collaborator.username;
});
// collaborator may not view ownedProject as a collaborator, but owns it
ownedProject.collaborators.list[1].username = 'api-access-somebody-else';
ownedProject.collaborators.list[1].userID = 'api-access-somebody-else';

const login = async (credentials) => {
  const agent = chai.request.agent(U.getServer());
  await agent.post('/localSignup').send(credentials);
  // /localSignup answers before its insert has finished.
  await U.delay(500);
  const res = await agent.post('/localLogin').redirects(0)
    .send(credentials);
  expect(res).to.have.cookie('connect.sid');

  return agent;
};

// All the shortnames GET /project/json returns, following its pages.
const listAllProjects = async (request) => {
  const names = [];
  for (let page = 0; page < 100; page++) {
    // eslint-disable-next-line no-await-in-loop -- pages are read in order
    const res = await request().get('/project/json')
      .query({ page });
    assert.equal(res.status, 200);
    assert.isArray(res.body);
    names.push(...res.body);
    // a short page is the last one; a long one is an unpaged answer
    if (res.body.length !== 20) {
      break;
    }
  }

  return names;
};

const searchProjects = async (request, q) => {
  const res = await request().get('/search/json/projects')
    .query({ q });
  assert.equal(res.status, 200);
  const projects = JSON.parse(res.text);
  assert.isArray(projects);

  return projects.map((p) => p.shortname);
};

describe('Route access checks: project list and search (M1)', function () {
  let collaboratorAgent, strangerAgent;
  const anonymous = () => chai.request(U.serverURL);
  const asCollaborator = () => collaboratorAgent;
  const asStranger = () => strangerAgent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await Promise.all([publicProject, privateProject, ownedProject].map((p) => U.insertProject(p)));
    collaboratorAgent = await login(collaborator);
    strangerAgent = await login(stranger);
  });

  after(async function () {
    await Promise.all([
      ...[publicProject, privateProject, ownedProject].map((p) => U.removeProject(p.shortname)),
      U.removeLocalUser(collaborator.username),
      U.removeLocalUser(stranger.username)
    ]);
  });

  describe('GET /project/json', function () {
    it('lists a public project but no private one (anonymous)', async function () {
      const names = await listAllProjects(anonymous);
      assert.include(names, publicProject.shortname);
      assert.notInclude(names, privateProject.shortname);
      assert.notInclude(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('lists no private project to a logged-in stranger', async function () {
      const names = await listAllProjects(asStranger);
      assert.include(names, publicProject.shortname);
      assert.notInclude(names, privateProject.shortname);
      assert.notInclude(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('lists the private projects a user collaborates on or owns', async function () {
      const names = await listAllProjects(asCollaborator);
      assert.include(names, publicProject.shortname);
      assert.include(names, privateProject.shortname);
      assert.include(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('pages hold at most 20 projects and do not repeat', async function () {
      const res = await anonymous().get('/project/json')
        .query({ page: 0 });
      assert.isAtMost(res.body.length, 20);
      const names = await listAllProjects(anonymous);
      assert.equal(new Set(names).size, names.length);
    }).timeout(U.shortTimeout);
  });

  describe('GET /search/json/projects', function () {
    it('finds a public project but no private one (anonymous)', async function () {
      const names = await searchProjects(anonymous, 'apiaccess');
      assert.include(names, publicProject.shortname);
      assert.notInclude(names, privateProject.shortname);
      assert.notInclude(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('finds no private project for a logged-in stranger', async function () {
      const names = await searchProjects(asStranger, 'apiaccess');
      assert.include(names, publicProject.shortname);
      assert.notInclude(names, privateProject.shortname);
      assert.notInclude(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('finds the private projects a user collaborates on or owns', async function () {
      const names = await searchProjects(asCollaborator, 'apiaccess');
      assert.include(names, publicProject.shortname);
      assert.include(names, privateProject.shortname);
      assert.include(names, ownedProject.shortname);
    }).timeout(U.shortTimeout);

    it('returns only shortname and name', async function () {
      const res = await anonymous().get('/search/json/projects')
        .query({ q: publicProject.shortname });
      const projects = JSON.parse(res.text);
      assert.isNotEmpty(projects);
      projects.forEach((p) => assert.hasAllKeys(p, ['shortname', 'name']));
    }).timeout(U.shortTimeout);
  });

  describe('GET /search/json/users', function () {
    it('returns only the public fields username and name', async function () {
      const res = await anonymous().get('/search/json/users')
        .query({ q: 'api-access-' });
      assert.equal(res.status, 200);
      const users = JSON.parse(res.text);
      assert.isNotEmpty(users);
      users.forEach((u) => assert.includeMembers(['username', 'name'], Object.keys(u)));
    }).timeout(U.shortTimeout);
  });
});
