'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const U = require('../mocha.test.util');

// M3: the project page (GET /project/:name) puts into the page only what the
// visitor may see, as GET /project/json/:name does (M1); a project without an
// 'anyone' collaborator has no public access, and never answers 500.
const member = { username: 'm3c-member', password: 'm3c-member-password' };

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
  let agent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertProject({ ...filesOnly });
    await U.insertProject({ ...noAnyone });
    agent = await login(member);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(filesOnly.shortname),
      U.removeProject(noAnyone.shortname),
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
  });

  describe('a project without an \'anyone\' entry', function () {
    it('is refused to anonymous visitors (403, not 500)', async function () {
      const anon = chai.request(U.serverURL);
      for (const url of [`/project/json/${noAnyone.shortname}`, `/project/${noAnyone.shortname}`, `/project/${noAnyone.shortname}/settings`]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await anon.get(url);
        assert.equal(res.status, 403, url);
      }
    }).timeout(U.shortTimeout);

    it('is shown to its collaborator', async function () {
      for (const url of [`/project/json/${noAnyone.shortname}`, `/project/${noAnyone.shortname}`]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await agent.get(url);
        assert.equal(res.status, 200, url);
      }
    }).timeout(U.shortTimeout);

    it('is not listed or found for anonymous visitors, and lists still answer', async function () {
      const anon = chai.request(U.serverURL);
      let res = await anon.get('/project/json').query({ page: 0 });
      assert.equal(res.status, 200);
      assert.notInclude(res.body, noAnyone.shortname);
      res = await anon.get('/search/json/projects').query({ q: 'm3cnoanyone' });
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), []);
      res = await anon.get('/user/json/m3c-owner/projects');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.list.map((p) => p.shortname), [filesOnly.shortname]);
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
