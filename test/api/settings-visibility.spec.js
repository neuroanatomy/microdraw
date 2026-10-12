'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// S2: the settings page (GET /project/:name/settings) embeds only what the
// visitor may see, by the same rule as the project page (M3c,
// visibleProject.js): no annotation layers without annotations view rights,
// no collaborators other than 'anyone' without collaborators view rights.
const member = { username: 's2-member', password: 's2-member-password' };
const editor = { username: 's2-editor', password: 's2-editor-password' };

// The value of `const <name>=…;` in a rendered page.
const inlineValue = (html, name) => {
  const match = html.match(new RegExp(`const ${name}=(.*);\\n`));
  assert.exists(match, `no inline ${name}`);

  return JSON.parse(match[1]);
};

const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });

const project = (shortname, anyoneAccess) => ({
  name: `S2 ${shortname}`,
  shortname,
  url: '',
  owner: 's2-owner',
  collaborators: {
    list: [
      { username: 'anyone', access: anyoneAccess },
      { username: member.username, userID: member.username, access: access('view', 'view', 'view') },
      { username: 's2-secret-collaborator', access: access('edit', 'edit', 'edit') },
      { username: editor.username, access: access('edit', 'none', 'none') }
    ]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'text', name: 's2 secret layer', values: 's2 secret values', display: true }] }
});

describe('What the settings page shows (S2)', function () {
  const filesOnly = project('s2filesonly', access('view', 'none', 'none'));
  const layersOnly = project('s2layersonly', access('view', 'view', 'none'));
  let agent, editorAgent;

  const login = async (user) => {
    await U.signUp(user);
    const a = chai.request.agent(U.getServer());
    await a.post('/localLogin').redirects(0)
      .send(user);

    return a;
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    await U.insertProject([{ ...filesOnly }, { ...layersOnly }]);
    agent = await login(member);
    editorAgent = await login(editor);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(filesOnly.shortname),
      U.removeProject(layersOnly.shortname),
      U.removeLocalUser(member.username),
      U.removeLocalUser(editor.username)
    ]);
  });

  it('a visitor who may only view the files gets no annotation layers and no collaborators but \'anyone\'', async function () {
    const res = await chai.request(U.serverURL).get(`/project/${filesOnly.shortname}/settings`);
    assert.equal(res.status, 200);
    assert.isFalse(res.text.includes('s2 secret layer'), 'a hidden annotation layer is in the page');
    assert.isFalse(res.text.includes('s2 secret values'), 'hidden annotation values are in the page');
    assert.isFalse(res.text.includes('s2-secret-collaborator'), 'a hidden collaborator is in the page');
    const info = inlineValue(res.text, 'project');
    assert.deepEqual(info.annotations.list, []);
    assert.deepEqual(info.collaborators.list.map((c) => c.username), ['anyone']);
    assert.deepEqual(info.files.list, filesOnly.files.list);
  }).timeout(U.shortTimeout);

  it('a visitor who may view the layers but not the collaborators gets the layers only', async function () {
    const res = await chai.request(U.serverURL).get(`/project/${layersOnly.shortname}/settings`);
    assert.equal(res.status, 200);
    const info = inlineValue(res.text, 'project');
    assert.deepEqual(info.annotations.list.map((a) => a.name), ['s2 secret layer']);
    assert.deepEqual(info.collaborators.list.map((c) => c.username), ['anyone']);
  }).timeout(U.shortTimeout);

  it('a collaborator who may view them gets them', async function () {
    const res = await agent.get(`/project/${filesOnly.shortname}/settings`);
    assert.equal(res.status, 200);
    const info = inlineValue(res.text, 'project');
    assert.lengthOf(info.annotations.list, 1);
    assert.deepEqual(info.collaborators.list.map((c) => c.username), ['anyone', member.username, 's2-secret-collaborator', editor.username]);
  }).timeout(U.shortTimeout);

  it('saving the page back without the hidden lists keeps them stored', async function () {
    let res = await editorAgent.get(`/project/${filesOnly.shortname}/settings`);
    assert.equal(res.status, 200);
    const info = inlineValue(res.text, 'project');
    assert.deepEqual(info.annotations.list, []);
    info.files.list[0].name = 'renamed cat';
    res = await editorAgent.post(`/project/json/${filesOnly.shortname}`).send({ data: info });
    assert.equal(res.status, 200, res.text);
    const stored = await U.queryProject(filesOnly.shortname);
    assert.equal(stored.files.list[0].name, 'renamed cat', res.body.message);
    assert.deepEqual(stored.annotations.list, filesOnly.annotations.list);
    assert.deepEqual(stored.collaborators.list, filesOnly.collaborators.list);
  }).timeout(U.shortTimeout);
});
