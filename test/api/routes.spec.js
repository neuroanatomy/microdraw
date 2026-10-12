'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// Shapes of the project, user and search JSON routes, for public data, read
// anonymously. Routes whose current behaviour is a known bug or a leak are
// left to M1/M2 (see docs/catchup-status.md).
// eslint-disable-next-line max-statements
describe('Project, user and search JSON routes', function () {
  const username = 'api-routes-user';
  const publicProject = U.createProjectWithPermission('apiroutespublic', { files: 'view' });
  const privateProject = U.createProjectWithPermission('apiroutesprivate', {});
  // anyone can view the public project's files, collaborators and annotations
  publicProject.collaborators.list[0].access = { collaborators: 'view', annotations: 'view', files: 'view' };
  [publicProject, privateProject].forEach((project) => {
    project.collaborators.list[1].username = username;
    project.collaborators.list[1].userID = username;
    project.collaborators.list[1].name = username;
  });

  before(async function () {
    await chai.request(U.serverURL).post('/localSignup')
      .send({ username, password: 'routes-password' });
    await Promise.all([U.insertProject(publicProject), U.insertProject(privateProject)]);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(publicProject.shortname),
      U.removeProject(privateProject.shortname),
      U.removeLocalUser(username)
    ]);
  });

  it('GET /project/json/:name returns a public project', async function () {
    const res = await chai.request(U.serverURL).get(`/project/json/${publicProject.shortname}`);
    assert.equal(res.status, 200);
    assert.include(res.body, { name: publicProject.name, shortname: publicProject.shortname, owner: publicProject.owner });
    for (const key of ['collaborators', 'files', 'annotations']) {
      assert.isArray(res.body[key].list, `${key}.list`);
    }
    assert.deepEqual(res.body.files.list, publicProject.files.list);
    assert.deepEqual(res.body.annotations.list, publicProject.annotations.list);
  }).timeout(U.shortTimeout);

  it('GET /project/json/:name is 404 for a project that does not exist', async function () {
    const res = await chai.request(U.serverURL).get('/project/json/apiroutesnosuchproject');
    assert.equal(res.status, 404);
    assert.property(res.body, 'error');
  }).timeout(U.shortTimeout);

  it('GET /user/json/:name/projects lists the projects the visitor may see', async function () {
    const res = await chai.request(U.serverURL).get(`/user/json/${username}/projects`);
    assert.equal(res.status, 200);
    assert.isTrue(res.body.successful);
    const names = res.body.list.map((project) => project.shortname);
    assert.include(names, publicProject.shortname);
    assert.notInclude(names, privateProject.shortname, 'an anonymous visitor sees the private project');
  }).timeout(U.shortTimeout);

  it('GET /search/json/users returns matching user names only', async function () {
    const res = await chai.request(U.serverURL).get('/search/json/users')
      .query({ q: 'api-routes-us' });
    assert.equal(res.status, 200);
    const users = JSON.parse(res.text);
    assert.isArray(users);
    const match = users.find((u) => u.username === username);
    assert.exists(match, `${username} not found in ${res.text}`);
    assert.notProperty(match, 'passhash');
  }).timeout(U.shortTimeout);

  it('GET /search/json/projects returns a matching public project', async function () {
    const res = await chai.request(U.serverURL).get('/search/json/projects')
      .query({ q: publicProject.shortname });
    assert.equal(res.status, 200);
    const projects = JSON.parse(res.text);
    assert.isArray(projects);
    const match = projects.find((p) => p.shortname === publicProject.shortname);
    assert.exists(match, `${publicProject.shortname} not found in ${res.text}`);
    assert.equal(match.name, publicProject.name);
  }).timeout(U.shortTimeout);
});
