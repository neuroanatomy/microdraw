'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// GET /project/json/:projectName/files?start&length[&names=true]: a slice of
// the current version's files, as BrainBox's route (shared suite route:files,
// 2026-11-11). The suite reads 2 files from 0; these are the edges.
const member = { username: 'pf-member', password: 'pf-member-password' };
const outsider = { username: 'pf-outsider', password: 'pf-outsider-password' };
const NFILES = 5;
const file = (i) => ({ source: `/test_data/pf-${i}.json`, name: `pf ${i}`, extra: i });

const project = (shortname, anyoneFiles, extra = {}) => ({
  name: `Files ${shortname}`,
  shortname,
  url: '',
  owner: 'pf-owner',
  collaborators: {
    list: [
      { username: 'anyone', userID: 'anyone', access: { collaborators: 'view', annotations: 'view', files: anyoneFiles } },
      { username: member.username, userID: member.username, access: { collaborators: 'view', annotations: 'view', files: 'view' } }
    ]
  },
  files: { list: Array.from({ length: NFILES }, (_x, i) => file(i)) },
  annotations: { list: [] },
  ...extra
});

// eslint-disable-next-line max-statements
describe('GET /project/json/:projectName/files (route:files)', function () {
  const open = project('pfopen', 'view');
  const closed = project('pfclosed', 'none');
  const route = (shortname, query) => `/project/json/${shortname}/files${query}`;
  const anonymous = () => chai.request(U.serverURL);
  let memberAgent;
  let outsiderAgent;
  let outsiderToken;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    // a backup with other files: only the current version is read
    await U.insertProject(project('pfopen', 'view', { files: { list: [file(9)] }, backup: true }));
    await U.insertProject({ ...open });
    await U.insertProject({ ...closed });
    memberAgent = await U.logIn(member);
    outsiderAgent = await U.logIn(outsider);
    ({ token: outsiderToken } = (await outsiderAgent.get('/token')).body);
  });

  after(async function () {
    await Promise.all([
      U.removeProject(open.shortname),
      U.removeProject(closed.shortname),
      U.removeLocalUser(member.username),
      U.removeLocalUser(outsider.username)
    ]);
  });

  describe('paging', function () {
    const sources = (res) => res.body.map((f) => f.source);

    it('answers the files from start, at most length, of the current version', async function () {
      const res = await anonymous().get(route(open.shortname, '?start=1&length=2'));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, [file(1), file(2)]);
    }).timeout(U.shortTimeout);

    it('cuts a slice that goes past the end', async function () {
      const res = await anonymous().get(route(open.shortname, `?start=${NFILES - 2}&length=10`));
      assert.deepEqual(sources(res), [file(NFILES - 2).source, file(NFILES - 1).source]);
    }).timeout(U.shortTimeout);

    it('answers an empty list from the end on, and for length 0', async function () {
      const answers = await Promise.all([`?start=${NFILES}&length=2`, '?start=100&length=2', '?start=0&length=0']
        .map((query) => anonymous().get(route(open.shortname, query))));
      assert.deepEqual(answers.map((res) => [res.status, res.body]), [[200, []], [200, []], [200, []]]);
    }).timeout(U.shortTimeout);

    it('counts a negative or non-numeric start or length as 0', async function () {
      const answers = await Promise.all(['?start=-2&length=2', '?start=x&length=1', '?start=0&length=-1', '?start=0&length=x']
        .map((query) => anonymous().get(route(open.shortname, query))));
      assert.deepEqual(answers.map(sources), [[file(0).source, file(1).source], [file(0).source], [], []]);
    }).timeout(U.shortTimeout);

    it('answers only the source and name with names=true', async function () {
      const res = await anonymous().get(route(open.shortname, '?start=0&length=2&names=true'));
      assert.deepEqual(res.body, [{ source: file(0).source, name: file(0).name }, { source: file(1).source, name: file(1).name }]);
    }).timeout(U.shortTimeout);

    it('asks for start and for length, as BrainBox', async function () {
      const answers = await Promise.all(['?length=2', '?start=0']
        .map((query) => anonymous().get(route(open.shortname, query))));
      assert.deepEqual(answers.map((res) => [res.status, res.body]), [[200, { error: 'Provide \'start\'' }], [200, { error: 'Provide \'length\'' }]]);
    }).timeout(U.shortTimeout);
  });

  describe('access', function () {
    it('answers 404 with a JSON error for a project that does not exist', async function () {
      const res = await anonymous().get(route('pfnosuchproject', '?start=0&length=2'));
      assert.equal(res.status, 404);
      assert.include(res.body.error, 'pfnosuchproject');
    }).timeout(U.shortTimeout);

    it('refuses a logged-out visitor without view access (401)', async function () {
      const res = await anonymous().get(route(closed.shortname, '?start=0&length=2'));
      assert.equal(res.status, 401);
      assert.isString(res.body.error);
    }).timeout(U.shortTimeout);

    it('refuses a non-member, by session and by token (403)', async function () {
      const bySession = await outsiderAgent.get(route(closed.shortname, '?start=0&length=2'));
      const byToken = await anonymous().get(route(closed.shortname, `?start=0&length=2&token=${outsiderToken}`));
      assert.deepEqual([bySession.status, byToken.status], [403, 403]);
      assert.notInclude(bySession.text, file(0).source);
    }).timeout(U.shortTimeout);

    it('answers a member', async function () {
      const res = await memberAgent.get(route(closed.shortname, '?start=0&length=10'));
      assert.equal(res.status, 200);
      assert.lengthOf(res.body, NFILES);
    }).timeout(U.shortTimeout);
  });
});
