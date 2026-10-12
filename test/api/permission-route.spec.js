'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// H3a: GET /api/permissions?project=<shortname> tells the viewer whether the
// current user (or 'anyone' when logged out) may view and edit the project's
// annotations. The viewer asks it before offering to import annotations kept
// in the browser (the H3 stash): only into a project the user can edit.
// eslint-disable-next-line max-statements
describe('GET /api/permissions (H3a)', function () {
  const editable = U.createPublicAnnotationProject('h3apermissionsedit');
  const viewOnly = U.createProjectWithPermission('h3apermissionsview', {});
  viewOnly.collaborators.list[0].access = { collaborators: 'none', annotations: 'view', files: 'view' };
  const permissions = (project) => chai.request(U.serverURL).get('/api/permissions')
    .query(typeof project === 'undefined' ? {} : { project });

  before(async function () {
    await U.insertProject(editable);
    await U.insertProject(viewOnly);
  });

  after(async function () {
    await U.removeProject(editable.shortname);
    await U.removeProject(viewOnly.shortname);
  });

  it('says anyone may edit the annotations of a public-edit project', async function () {
    const res = await permissions(editable.shortname);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { project: editable.shortname, annotations: { view: true, edit: true } });
  }).timeout(U.shortTimeout);

  it('says a visitor may only view the annotations of a view-only project', async function () {
    const res = await permissions(viewOnly.shortname);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { project: viewOnly.shortname, annotations: { view: true, edit: false } });
  }).timeout(U.shortTimeout);

  it('says whether the project lists an image, when asked with source', async function () {
    const listed = await chai.request(U.serverURL).get('/api/permissions')
      .query({ project: editable.shortname, source: '/test_data/cat.json' });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.image, { source: '/test_data/cat.json', listed: true });
    const notListed = await chai.request(U.serverURL).get('/api/permissions')
      .query({ project: editable.shortname, source: '/test_data/not-listed.json' });
    assert.deepEqual(notListed.body.image, { source: '/test_data/not-listed.json', listed: false });
  }).timeout(U.shortTimeout);

  it('answers 404 for a project that does not exist', async function () {
    const res = await permissions('h3apermissionsmissing');
    assert.equal(res.status, 404);
  }).timeout(U.shortTimeout);

  it('answers 400 without a project', async function () {
    const res = await permissions();
    assert.equal(res.status, 400);
  }).timeout(U.shortTimeout);
});
