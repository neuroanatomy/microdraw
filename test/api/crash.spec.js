'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// Anonymous requests that used to throw inside an async Express handler. Each
// must get a clean answer, and the server must keep serving afterwards.
const publicProject = {
  name: 'Crash spec public project',
  shortname: 'crashspecpublic',
  url: '',
  created: '2026-10-12T00:00:00.000Z',
  owner: 'crash-spec-owner',
  collaborators: {
    list: [
      {
        username: 'anyone',
        access: { collaborators: 'view', annotations: 'view', files: 'view' },
        name: 'Any User'
      }
    ]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'Cat' }] },
  annotations: { list: [{ type: 'vectorial', values: 'Set I', display: true, name: 'layer' }] }
};
const missingProject = 'crashspecmissing';

// A hung request (the old crash) fails the test instead of the run.
const get = (pathname) => chai.request(U.serverURL).get(pathname)
  .timeout(3000);

const assertStillServing = async () => {
  const res = await get(`/project/json/${publicProject.shortname}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.shortname, publicProject.shortname);
};

describe('Anonymous requests that must not crash the server', function () {
  before(async function () {
    await U.insertProject({ ...publicProject });
  });

  after(async function () {
    await U.removeProject(publicProject.shortname);
  });

  describe('GET /project/json/:projectName', function () {
    it('returns the public project', async function () {
      const res = await get(`/project/json/${publicProject.shortname}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.name, publicProject.name);
      assert.equal(res.body.owner, publicProject.owner);
      assert.deepEqual(res.body.files.list, publicProject.files.list);
      assert.isArray(res.body.collaborators.list);
      assert.isArray(res.body.annotations.list);
    }).timeout(U.shortTimeout);

    it('?var=name returns the project name', async function () {
      const res = await get(`/project/json/${publicProject.shortname}?var=name`);
      assert.equal(res.status, 200);
      assert.equal(res.text, publicProject.name);
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('?var=files/list/0/name follows a nested path', async function () {
      const res = await get(`/project/json/${publicProject.shortname}?var=files/list/0/name`);
      assert.equal(res.status, 200);
      assert.equal(res.text, 'Cat');
    }).timeout(U.shortTimeout);

    it('a ?var= path that does not exist answers 500 JSON', async function () {
      const res = await get(`/project/json/${publicProject.shortname}?var=no/such/path`);
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: 'Server error' });
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('a missing project answers 404 JSON', async function () {
      const res = await get(`/project/json/${missingProject}`);
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'Project not found' });
      await assertStillServing();
    }).timeout(U.shortTimeout);
  });

  describe('GET /api', function () {
    it('?project=<missing> answers 404 JSON', async function () {
      const res = await get(`/api?project=${missingProject}&source=/test_data/cat.json&slice=0`);
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'Project not found' });
      await assertStillServing();
    }).timeout(U.shortTimeout);

    it('?project=<public> still returns the annotations array', async function () {
      const res = await get(`/api?project=${publicProject.shortname}&source=/test_data/cat.json&slice=0`);
      assert.equal(res.status, 200);
      assert.isArray(res.body);
    }).timeout(U.shortTimeout);
  });
});
