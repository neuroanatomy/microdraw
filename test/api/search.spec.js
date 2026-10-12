'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const { escapeRegex } = require('../../app/controller/search/search.controller');

// M3: /search/json/* match the search text literally (it went into a MongoDB
// $regex as it was: ReDoS, and an invalid pattern made the query fail and the
// error go out with status 200), answer JSON as application/json, and errors
// with 4xx/5xx statuses. GET /user/<unknown> answers 404.
const project = U.createProjectWithPermission('m3dsearchproject', { files: 'view' });
project.collaborators.list[0].access.files = 'view';
const user = { username: 'm3d-search-user', name: 'M3d Search' };

const get = (pathname, query) => chai.request(U.serverURL).get(pathname)
  .query(query);

const isJSON = (res) => assert.match(res.headers['content-type'], /^application\/json/);

describe('Search and user routes (M3)', function () {
  before(async function () {
    await U.insertProject({ ...project });
    await U.insertUser({ ...user });
  });

  after(async function () {
    await U.removeProject(project.shortname);
    await U.removeLocalUser(user.username);
  });

  it('escapeRegex escapes every regular expression character', function () {
    const special = '.*+?^${}()|[]\\';
    assert.equal(escapeRegex(special), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    assert.isTrue(new RegExp(escapeRegex(special)).test(`x${special}y`));
  });

  for (const route of ['projects', 'users']) {
    describe(`GET /search/json/${route}`, function () {
      it('an invalid pattern is searched literally: 200 and an empty JSON list', async function () {
        const res = await get(`/search/json/${route}`, { q: '(' });
        assert.equal(res.status, 200);
        isJSON(res);
        assert.deepEqual(res.body, []);
      }).timeout(U.shortTimeout);

      it('regular expression characters match literally', async function () {
        const res = await get(`/search/json/${route}`, { q: 'm3d.*' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, []);
      }).timeout(U.shortTimeout);

      it('a catastrophic pattern answers at once', async function () {
        const res = await get(`/search/json/${route}`, { q: '(a+)+$' })
          .timeout(2000);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, []);
      }).timeout(U.shortTimeout);

      it('a q that is not a string answers 400 JSON', async function () {
        const res = await chai.request(U.serverURL).get(`/search/json/${route}?q[$ne]=x`);
        assert.equal(res.status, 400);
        isJSON(res);
      }).timeout(U.shortTimeout);
    });
  }

  it('plain text still finds projects and users, as JSON', async function () {
    let res = await get('/search/json/projects', { q: 'm3dsearch' });
    isJSON(res);
    assert.deepEqual(res.body.map((p) => p.shortname), [project.shortname]);
    res = await get('/search/json/users', { q: 'm3d-search' });
    isJSON(res);
    assert.deepEqual(res.body, [{ username: user.username, name: user.name }]);
  }).timeout(U.shortTimeout);

  it('GET /user/<unknown> answers 404', async function () {
    const res = await get('/user/m3d-no-such-user');
    assert.equal(res.status, 404);
  }).timeout(U.shortTimeout);
});
