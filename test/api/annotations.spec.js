'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// Saving annotations through the token-protected upload route and reading
// them back with load_last, against the real server and test database.
describe('Annotation upload and load_last', function () {
  const credentials = { username: 'api-annotations-user', password: 'annotations-password' };
  const source = 'api-roundtrip-source';
  const region = {
    annotation: {
      name: 'round trip region',
      path: ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }]
    }
  };
  const upload = (token) => chai.request(U.serverURL)
    .post('/api/upload')
    .query(Object.assign({ action: 'save', source, slice: 0, project: '' }, token ? { token } : {}))
    .attach('data', Buffer.from(JSON.stringify([region])), 'annotation.json');
  let token;

  before(async function () {
    await chai.request(U.serverURL).post('/localSignup')
      .send(credentials);
    const agent = chai.request.agent(U.getServer());
    await agent.post('/localLogin').redirects(0)
      .send(credentials);
    ({ token } = (await agent.get('/token')).body);
    assert.isNotEmpty(token);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeLocalUser(credentials.username);
  });

  it('refuses an upload without a token', async function () {
    const res = await upload();
    assert.equal(res.status, 401);
    const load = await chai.request(U.serverURL).get('/api')
      .query({ action: 'load_last', source, slice: 0 });
    assert.lengthOf(load.body, 0, 'the refused upload was saved anyway');
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('saves an upload with a token, and load_last returns it', async function () {
    const res = await upload(token);
    assert.equal(res.status, 200);

    const load = await chai.request(U.serverURL).get('/api')
      .query({ action: 'load_last', source, slice: 0 });
    assert.equal(load.status, 200);
    assert.lengthOf(load.body, 1);
    const [saved] = load.body;
    assert.equal(saved.fileID, `${source}&slice=0`);
    assert.equal(saved.user, credentials.username);
    assert.equal(saved.annotation.name, region.annotation.name);
    assert.deepEqual(saved.annotation.path, region.annotation.path);
    assert.isNotEmpty(saved.annotation.uid);
  }).timeout(U.shortTimeout);
});
