'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// H2a: POST /api/upload (action=save|append) checks canEditAnnotations on the
// target project, as the editor save (POST /api, saveFromGUI) does. Before H2a
// any logged-in user could write annotations into any project.
// eslint-disable-next-line max-statements
describe('POST /api/upload checks the annotation edit permission (H2a)', function () {
  const source = 'h2a-upload-permissions-source';
  const stranger = { username: 'h2a-stranger', password: 'h2a-stranger-password' };
  const editor = { username: 'h2a-editor', password: 'h2a-editor-password' };
  const viewer = { username: 'h2a-viewer', password: 'h2a-viewer-password' };
  const collaborator = (user, annotations) => ({
    userID: user.username,
    username: user.username,
    name: user.username,
    access: { collaborators: 'none', annotations, files: 'view' }
  });
  const project = (shortname, anyoneAnnotations) => ({
    name: shortname,
    shortname,
    url: '',
    created: '2026-10-12T00:00:00.000Z',
    owner: 'h2a-owner',
    collaborators: {
      list: [
        {
          username: 'anyone',
          name: 'Any User',
          access: { collaborators: 'none', annotations: anyoneAnnotations, files: 'view' }
        },
        collaborator(editor, 'edit'),
        collaborator(viewer, 'view')
      ]
    },
    files: { list: [{ source, name: 'h2a' }] },
    annotations: { list: [] }
  });
  const privateProject = project('h2aprivate', 'none');
  const publicEditProject = project('h2apublicedit', 'edit');
  const region = (name) => ({
    annotation: {
      name,
      path: ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }]
    }
  });
  const tokens = {};
  const agents = {};

  const login = async (user) => {
    const agent = await U.logIn(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    agents[user.username] = agent;
    tokens[user.username] = token;
  };

  // Upload with a token (the API client's path).
  const upload = (user, shortname, action, name) => chai.request(U.serverURL)
    .post('/api/upload')
    .query({ action, source, slice: 0, project: shortname, token: tokens[user.username] })
    .attach('data', Buffer.from(JSON.stringify([region(name)])), 'annotation.json');

  // Upload with the session cookie and no token (a logged-in browser).
  const uploadWithSession = (user, shortname, action, name) => agents[user.username]
    .post('/api/upload')
    .query({ action, source, slice: 0, project: shortname })
    .attach('data', Buffer.from(JSON.stringify([region(name)])), 'annotation.json');

  // Names of the current (non-backup) annotations, read as the editor.
  const savedNames = async (shortname) => {
    const res = await chai.request(U.serverURL).get('/api')
      .query({ source, slice: 0, project: shortname, token: tokens[editor.username] });
    assert.equal(res.status, 200);

    return res.body.map((a) => a.annotation.name).sort();
  };

  before(async function () {
    await Promise.all([stranger, editor, viewer].map(login));
    await U.insertProject(privateProject);
    await U.insertProject(publicEditProject);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeProject(privateProject.shortname);
    await U.removeProject(publicEditProject.shortname);
    await Promise.all([stranger, editor, viewer].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await U.removeAnnotations(source);
  });

  ['save', 'append'].forEach((action) => {
    it(`refuses a stranger's ${action} into a private project (token), and saves nothing`, async function () {
      const res = await upload(stranger, privateProject.shortname, action, 'intruder');
      assert.equal(res.status, 403);
      assert.deepEqual(await savedNames(privateProject.shortname), []);
    }).timeout(U.shortTimeout);

    it(`refuses a stranger's ${action} into a private project (session, no token)`, async function () {
      const res = await uploadWithSession(stranger, privateProject.shortname, action, 'intruder');
      assert.equal(res.status, 403);
      assert.deepEqual(await savedNames(privateProject.shortname), []);
    }).timeout(U.shortTimeout);

    it(`refuses a view-only collaborator's ${action}`, async function () {
      const res = await upload(viewer, privateProject.shortname, action, 'viewer');
      assert.equal(res.status, 403);
      assert.deepEqual(await savedNames(privateProject.shortname), []);
    }).timeout(U.shortTimeout);

    it(`accepts a collaborator's ${action} with edit access`, async function () {
      const res = await upload(editor, privateProject.shortname, action, 'editor');
      assert.equal(res.status, 200);
      assert.deepEqual(await savedNames(privateProject.shortname), ['editor']);
    }).timeout(U.shortTimeout);

    it(`accepts a stranger's ${action} when anyone may edit annotations`, async function () {
      const res = await upload(stranger, publicEditProject.shortname, action, 'public');
      assert.equal(res.status, 200);
      assert.deepEqual(await savedNames(publicEditProject.shortname), ['public']);
    }).timeout(U.shortTimeout);
  });
});
