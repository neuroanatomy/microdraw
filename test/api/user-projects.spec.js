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
// answers every project. start/length, the slicing after filtering and the
// counts are also in NeuroWebLab's shared suite (slice 3, 3.4 and 3.5); here
// the end of the list, bad values and a project without files.
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
const removeAll = () => U.getDB().collection('projects')
  .deleteMany({ shortname: { $regex: `^${PREFIX}` } });

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

  it('answers an empty list past the end', async function () {
    const res = await get(`/user/json/${owner}/projects?start=200&length=100`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.list, []);
  }).timeout(U.shortTimeout);

  it('reads a bad start or length as the defaults', async function () {
    const res = await get(`/user/json/${owner}/projects?start=-5&length=abc`);
    assert.equal(res.status, 200);
    assert.lengthOf(res.body.list, COUNT);
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
