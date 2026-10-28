'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// GET /user/json/:userName/projects?start=&length= answers one page of the
// user's projects (the user page reads them 100 at a time until a page is
// short), with each project's number of files and collaborators for the
// sortable Files and Collaborators columns. Without start/length it still
// answers every project.
const owner = 'api-user-projects-owner';
const PREFIX = 'apiuserprojects';
const COUNT = 105;
const shortname = (i) => `${PREFIX}${String(i).padStart(3, '0')}`;

const project = (i) => {
  const p = U.createProjectWithPermission(shortname(i), { files: 'view', collaborators: 'view' });
  p.owner = owner;
  p.collaborators.list[0].access.files = 'view';
  p.collaborators.list[0].access.collaborators = 'view';
  p.files.list = Array.from({ length: (i % 3) + 1 }, (_, k) => ({ source: `/test_data/${i}-${k}.json`, name: `f${k}` }));

  return p;
};

const get = (pathname) => chai.request(U.serverURL).get(pathname);
const removeAll = () => U.getDB().get('projects')
  .remove({ shortname: { $regex: `^${PREFIX}` } });

describe('User projects route, paged (/user/json/:userName/projects)', function () {
  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.shortTimeout);
    await removeAll();
    await U.insertUser({ username: owner, name: owner, joined: new Date() });
    await U.insertProject(Array.from({ length: COUNT }, (_, i) => project(i)));
  });

  after(async function () {
    await removeAll();
    await U.removeLocalUser(owner);
  });

  it('answers at most `length` projects from `start`', async function () {
    const first = await get(`/user/json/${owner}/projects?start=0&length=100`);
    assert.equal(first.status, 200);
    assert.isTrue(first.body.successful);
    assert.lengthOf(first.body.list, 100);
    const second = await get(`/user/json/${owner}/projects?start=100&length=100`);
    assert.lengthOf(second.body.list, COUNT - 100);
    const names = [...first.body.list, ...second.body.list].map((p) => p.shortname);
    assert.sameMembers(names, Array.from({ length: COUNT }, (_, i) => shortname(i)));
  }).timeout(U.shortTimeout);

  it('answers an empty list past the end', async function () {
    const res = await get(`/user/json/${owner}/projects?start=200&length=100`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.list, []);
  }).timeout(U.shortTimeout);

  it('answers every project without start and length', async function () {
    const res = await get(`/user/json/${owner}/projects`);
    assert.lengthOf(res.body.list, COUNT);
  }).timeout(U.shortTimeout);

  it('reads a bad start or length as the defaults', async function () {
    const res = await get(`/user/json/${owner}/projects?start=-5&length=abc`);
    assert.equal(res.status, 200);
    assert.lengthOf(res.body.list, COUNT);
  }).timeout(U.shortTimeout);

  it('gives each project its number of files and collaborators', async function () {
    const res = await get(`/user/json/${owner}/projects`);
    const p7 = res.body.list.find((p) => p.shortname === shortname(7));
    assert.strictEqual(p7.numFiles, 2);
    assert.strictEqual(p7.numCollaborators, 2);
  }).timeout(U.shortTimeout);

  it('counts 0 files for a project with no files list, without failing', async function () {
    const p = project(COUNT);
    delete p.files;
    await U.insertProject(p);
    const res = await get(`/user/json/${owner}/projects`);
    assert.equal(res.status, 200);
    const found = res.body.list.find((q) => q.shortname === shortname(COUNT));
    assert.strictEqual(found.numFiles, 0);
  }).timeout(U.shortTimeout);
});
