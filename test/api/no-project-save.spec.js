'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// H3b: annotations are only saved inside a project. The editor save (POST /api)
// and the API upload (POST /api/upload, save and append) answer 400 when the
// project is empty or missing, and store nothing. Before H3b they were stored
// with project '', and a save marked every user's '' annotations on the image
// as backups. Annotations saved outside a project before H3 stay readable.
// eslint-disable-next-line max-statements
describe('Saving annotations requires a project (H3b)', function () {
  const source = 'h3b-no-project-source';
  const user = { username: 'h3b-user', password: 'h3b-user-password' };
  const path = ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }];
  let token;
  let agent;

  // What is stored for the source outside a project, backups included.
  const storedOutsideProject = async () => {
    const res = await chai.request(U.serverURL).get('/api')
      .query({ source, slice: 0, backup: '' });
    assert.equal(res.status, 200);

    return res.body;
  };

  const guiBody = (project) => Object.assign({
    action: 'save',
    source,
    slice: 0,
    Hash: 'h3b',
    annotation: JSON.stringify({ Regions: [{ name: 'gui', uid: 'h3bgui', path }], RegionsToRemove: [] })
  }, project === null ? {} : { project });

  const upload = (action, project) => chai.request(U.serverURL)
    .post('/api/upload')
    .query(Object.assign({ action, source, slice: 0, token }, project === null ? {} : { project }))
    .attach('data', Buffer.from(JSON.stringify([{ annotation: { name: 'upload', path } }])), 'annotation.json');

  before(async function () {
    await chai.request(U.serverURL).post('/localSignup')
      .send(user);
    agent = chai.request.agent(U.getServer());
    await agent.post('/localLogin').redirects(0)
      .send(user);
    ({ token } = (await agent.get('/token')).body);
    assert.isNotEmpty(token);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeLocalUser(user.username);
  });

  beforeEach(async function () {
    await U.removeAnnotations(source);
  });

  // null: no project parameter at all
  [['an empty', ''], ['a missing', null]].forEach(([label, project]) => {
    it(`refuses an anonymous editor save with ${label} project (401: login first)`, async function () {
      const res = await chai.request(U.serverURL).post('/api')
        .send(guiBody(project));
      assert.equal(res.status, 401);
      assert.lengthOf(await storedOutsideProject(), 0);
    }).timeout(U.shortTimeout);

    it(`refuses a logged-in editor save with ${label} project`, async function () {
      const res = await agent.post('/api').send(guiBody(project));
      assert.equal(res.status, 400);
      assert.match(res.body.error, /requires a project/);
      assert.lengthOf(await storedOutsideProject(), 0);
    }).timeout(U.shortTimeout);

    ['save', 'append'].forEach((action) => {
      it(`refuses an API upload (${action}) with ${label} project`, async function () {
        const res = await upload(action, project);
        assert.equal(res.status, 400);
        assert.match(res.body.msg, /requires a project/);
        assert.lengthOf(await storedOutsideProject(), 0);
      }).timeout(U.shortTimeout);
    });
  });

  it('does not hide annotations saved outside a project before H3', async function () {
    const old = { name: 'old', uid: 'h3bold', path };
    await U.insertAnnotations([{ fileID: `${source}&slice=0`, user: 'someone-else', project: '', Hash: 'old', annotation: old }]);
    await agent.post('/api').send(guiBody(''));
    const res = await chai.request(U.serverURL).get('/api')
      .query({ source, slice: 0 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((a) => a.annotation.name), ['old']);
  }).timeout(U.shortTimeout);

  // The maintainer, 2026-10-12: no logged-out saves, even where 'anyone' may edit.
  describe('without a logged-in user or a valid token', function () {
    const publicEdit = U.createPublicAnnotationProject('h3bpublicedit');
    const projectAnnotations = async () => {
      const res = await chai.request(U.serverURL).get('/api')
        .query({ source, slice: 0, project: publicEdit.shortname });
      assert.equal(res.status, 200);

      return res.body;
    };

    before(async function () {
      await U.insertProject(publicEdit);
    });

    after(async function () {
      await U.removeProject(publicEdit.shortname);
    });

    it('refuses an anonymous editor save into a project where anyone may edit (401)', async function () {
      const res = await chai.request(U.serverURL).post('/api')
        .send(guiBody(publicEdit.shortname));
      assert.equal(res.status, 401);
      assert.lengthOf(await projectAnnotations(), 0);
    }).timeout(U.shortTimeout);

    it('refuses an editor save with an unknown token (401)', async function () {
      const res = await chai.request(U.serverURL).post('/api')
        .query({ token: 'h3b-not-a-token' })
        .send(guiBody(publicEdit.shortname));
      assert.equal(res.status, 401);
      assert.lengthOf(await projectAnnotations(), 0);
    }).timeout(U.shortTimeout);

    ['save', 'append'].forEach((action) => {
      it(`refuses an anonymous API upload (${action}) into a project where anyone may edit (401)`, async function () {
        const res = await chai.request(U.serverURL).post('/api/upload')
          .query({ action, source, slice: 0, project: publicEdit.shortname })
          .attach('data', Buffer.from(JSON.stringify([{ annotation: { name: 'upload', path } }])), 'annotation.json');
        assert.equal(res.status, 401);
        assert.lengthOf(await projectAnnotations(), 0);
      }).timeout(U.shortTimeout);
    });

    it('accepts a logged-in editor save into that project', async function () {
      const res = await agent.post('/api').send(guiBody(publicEdit.shortname));
      assert.equal(res.status, 200);
      assert.deepEqual((await projectAnnotations()).map((a) => a.annotation.name), ['gui']);
    }).timeout(U.shortTimeout);
  });
});
