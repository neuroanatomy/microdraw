'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M1: the project list and the searches only return what the requester may
// see. A private project is listed for its collaborators and owner, never for
// an anonymous visitor or a logged-in stranger. User search returns public
// fields only (T004 allow-list). Who is listed, the pages of 20 and project
// search by visitors and members are in NeuroWebLab's shared suite (slices 1
// and 3, test/api/conformance.spec.js); here the stored order, a project found
// by its owner and the exact fields.
const collaborator = { username: 'api-access-collab', password: 'access-collab-password' };

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

// Signs up (or finds the user already there) and logs in (U.logIn).
const login = (credentials) => U.logIn(credentials);

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
  let collaboratorAgent;
  const anonymous = () => chai.request(U.serverURL);
  const asCollaborator = () => collaboratorAgent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await Promise.all([publicProject, privateProject, ownedProject].map((p) => U.insertProject(p)));
    collaboratorAgent = await login(collaborator);
  });

  after(async function () {
    await Promise.all([
      ...[publicProject, privateProject, ownedProject].map((p) => U.removeProject(p.shortname)),
      U.removeLocalUser(collaborator.username)
    ]);
  });

  describe('GET /project/json', function () {
    // What the read gives, whichever driver reads it.
    describe('over several pages', function () {
      const PREFIX = 'apiaccesslist';
      const shortname = (i) => `${PREFIX}${String(i).padStart(2, '0')}`;
      const stored = (i, files) => {
        const p = U.createProjectWithPermission(shortname(i), { files: 'view' });
        p.collaborators.list[0].access.files = files;

        return p;
      };
      const count = 25;
      const shown = Array.from({ length: count }, (_, i) => i).filter((i) => i % 5 !== 0);
      const removeAll = () => U.removeProject({ $regex: `^${PREFIX}` });

      before(async function () {
        await removeAll();
        await U.insertProject([
          ...Array.from({ length: count }, (_, i) => stored(i, i % 5 === 0 ? 'none' : 'view')),
          { ...stored(count, 'view'), backup: true }
        ]);
      });

      after(removeAll);

      it('lists what the visitor may see in stored order, with no backup', async function () {
        const names = await listAllProjects(anonymous);
        assert.deepEqual(names.filter((name) => name.startsWith(PREFIX)), shown.map(shortname));
      }).timeout(U.shortTimeout);

    });
  });

  describe('GET /search/json/projects', function () {
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
