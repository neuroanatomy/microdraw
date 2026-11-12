'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M3: the project page (GET /project/:name) puts into the page only what the
// visitor may see, as GET /project/json/:name does (M1); a project without an
// 'anyone' collaborator has no public access, and never answers 500.
const member = { username: 'm3c-member', password: 'm3c-member-password' };

// Signs up (or finds the user already there) and logs in (U.logIn).
const login = (credentials) => U.logIn(credentials);

// The value of `const <name>=…;` in a rendered page.
const inlineValue = (html, name) => {
  const match = html.match(new RegExp(`const ${name}=(.*);\\n`));
  assert.exists(match, `no inline ${name}`);

  return JSON.parse(match[1]);
};

const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });

const project = (shortname, anyoneAccess) => ({
  name: `M3c ${shortname}`,
  shortname,
  url: '',
  owner: 'm3c-owner',
  collaborators: {
    list: [
      ...(anyoneAccess ? [{ username: 'anyone', name: 'Any User', access: anyoneAccess }] : []),
      { username: member.username, userID: member.username, name: 'Member', access: access('view', 'view', 'view') },
      { username: 'm3c-secret-collaborator', name: 'Secret', access: access('edit', 'edit', 'edit') }
    ]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'text', name: 'm3c secret layer', values: '', display: true }] }
});

// eslint-disable-next-line max-statements
describe('What the project page shows, and projects without \'anyone\' (M3)', function () {
  const filesOnly = project('m3cfilesonly', access('view', 'none', 'none'));
  const noAnyone = project('m3cnoanyone');
  // the member may view the annotations, not the collaborators; no 'anyone'
  // entry, so the project stays out of the public lists tested below
  const layersNotCollaborators = project('m3clayersnotcollab');
  layersNotCollaborators.collaborators.list.find((c) => c.username === member.username).access = access('view', 'view', 'none');
  let agent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertProject({ ...filesOnly });
    await U.insertProject({ ...noAnyone });
    await U.insertProject({ ...layersNotCollaborators });
    agent = await login(member);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(filesOnly.shortname),
      U.removeProject(noAnyone.shortname),
      U.removeProject(layersNotCollaborators.shortname),
      U.removeLocalUser(member.username)
    ]);
  });

  describe('GET /project/:name', function () {
    it('a visitor who may only view the files gets no collaborators or annotation layers in the page', async function () {
      const res = await chai.request(U.serverURL).get(`/project/${filesOnly.shortname}`);
      assert.equal(res.status, 200);
      assert.isFalse(res.text.includes('m3c-secret-collaborator'), 'a hidden collaborator is in the page');
      assert.isFalse(res.text.includes('m3c secret layer'), 'a hidden annotation layer is in the page');
      const info = inlineValue(res.text, 'projectInfo');
      assert.deepEqual(info.collaborators.list.map((c) => c.username), ['anyone']);
      assert.deepEqual(info.annotations.list, []);
      assert.deepEqual(info.files.list, filesOnly.files.list);
    }).timeout(U.shortTimeout);

    it('a collaborator who may view them gets them', async function () {
      const res = await agent.get(`/project/${filesOnly.shortname}`);
      assert.equal(res.status, 200);
      const info = inlineValue(res.text, 'projectInfo');
      assert.lengthOf(info.collaborators.list, 3);
      assert.lengthOf(info.annotations.list, 1);
    }).timeout(U.shortTimeout);

    // 2026-11-09: the visitor's own collaborator entry was removed before the
    // annotations check, so they were judged as 'anyone' and got no layers
    it('a collaborator who may view the annotations but not the collaborators gets the layers, not the collaborators', async function () {
      const res = await agent.get(`/project/${layersNotCollaborators.shortname}`);
      assert.equal(res.status, 200);
      const info = inlineValue(res.text, 'projectInfo');
      assert.deepEqual(info.collaborators.list, []);
      assert.isFalse(res.text.includes('m3c-secret-collaborator'), 'a hidden collaborator is in the page');
      assert.deepEqual(info.annotations.list.map((a) => a.name), ['m3c secret layer']);
      const json = await agent.get(`/project/json/${layersNotCollaborators.shortname}`);
      assert.equal(json.status, 200);
      assert.deepEqual(json.body.annotations.list.map((a) => a.name), ['m3c secret layer']);
      assert.deepEqual(json.body.collaborators.list, []);
    }).timeout(U.shortTimeout);
  });

  describe('a project without an \'anyone\' entry', function () {
    // refused (1.4), listed in neither GET /project/json nor the user's
    // projects (3.1, 3.3), shown to its collaborators: the shared suite, slice 1
    it('is not found by anonymous visitors', async function () {
      const res = await chai.request(U.serverURL).get('/search/json/projects')
        .query({ q: 'm3cnoanyone' });
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), []);
    }).timeout(U.shortTimeout);
  });

  describe('a project stored without lists', function () {
    const noLists = { shortname: 'm3cnolists', name: 'no lists', owner: member.username };

    before(async function () {
      await U.insertProject({ ...noLists });
    });

    after(async function () {
      await U.removeProject(noLists.shortname);
    });

    it('GET /project/json/:name gives its owner empty lists instead of 500', async function () {
      const res = await agent.get(`/project/json/${noLists.shortname}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.files.list, []);
      assert.deepEqual(res.body.collaborators.list, []);
    }).timeout(U.shortTimeout);
  });
});
