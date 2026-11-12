'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// The shape of the project JSON route, for a public project read anonymously:
// the files and layers as stored. The 404 of an unknown project, the user's
// projects and both searches are in NeuroWebLab's shared suite (slices 1 and
// 3, test/api/conformance.spec.js).
describe('Project, user and search JSON routes', function () {
  const publicProject = U.createProjectWithPermission('apiroutespublic', { files: 'view' });
  // anyone can view the public project's files, collaborators and annotations
  publicProject.collaborators.list[0].access = { collaborators: 'view', annotations: 'view', files: 'view' };

  before(async function () {
    await U.insertProject(publicProject);
  });

  after(async function () {
    await U.removeProject(publicProject.shortname);
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
});
