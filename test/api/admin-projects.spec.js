/* eslint-disable max-lines, max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const lock = require('../../app/controller/projectLock');

// A2: the admin section for the stored projects that don't validate
// (decisions D29). The list is computed by the same module as
// scripts/check-projects.js; the two fixes (remove blank rows, name unnamed
// layers) take the project lock, refuse a project changed since it was
// listed (409), log the previous document, save through the validation of
// normal saves, and can be restored.
const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });
const anyone = { username: 'anyone', name: 'Any User', access: access('view', 'view', 'view') };

// Fixtures shaped like the production cases (maintainer's check-projects
// run, 2026-10-12)
const fixtures = () => [
  // most common: the first annotation layer has no name, but values
  {
    name: 'A2 unnamed layer',
    shortname: 'a2unnamed',
    url: '',
    owner: 'a2-owner',
    collaborators: { list: [anyone] },
    files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
    annotations: {
      list: [
        { type: 'vectorial', name: '', values: 'Set 1', display: true },
        { type: 'vectorial', name: 'Layer 1', values: 'Set 2', display: true },
        { type: 'text', name: null, values: 'free text', display: true }
      ]
    }
  },
  // like project `x`: files with an empty source (some with a name), a
  // collaborator with an empty username, an empty annotation row, a user
  // that does not exist
  {
    name: 'A2 blank rows',
    shortname: 'a2blank',
    url: '',
    owner: 'a2-owner',
    collaborators: {
      list: [
        anyone,
        { username: '', access: access('view', 'view', 'view') },
        { username: 'voyageour', access: access('view', 'view', 'view') }
      ]
    },
    files: {
      list: [
        { source: '/test_data/cat.json', name: 'cat' },
        { source: '', name: 'named but empty' },
        { source: '', name: '' },
        '',
        { source: null, name: 'null source' }
      ]
    },
    annotations: {
      list: [
        { type: 'vectorial', name: 'cortex', values: '', display: true },
        { type: 'vectorial', name: '', values: '', display: true }
      ]
    }
  },
  // a non-alphanumeric shortname: listed only, never fixed
  {
    name: 'A2 odd shortname',
    shortname: 'a2-odd_name',
    url: '',
    owner: 'bountainmicycle',
    collaborators: { list: [anyone] },
    files: { list: [] },
    annotations: { list: [] }
  },
  // blocking: no 'anyone' entry, so it cannot be saved again; also has a
  // blank file row, which the fix cannot remove (the save would be refused)
  {
    name: 'A2 no anyone',
    shortname: 'a2noanyone',
    url: '',
    owner: 'a2-owner',
    collaborators: { list: [{ username: 'a2-owner', access: access('remove', 'remove', 'remove') }] },
    files: { list: [{ source: '', name: '' }] },
    annotations: { list: [] }
  },
  // valid: not listed
  {
    name: 'A2 clean',
    shortname: 'a2clean',
    url: '',
    owner: 'a2-owner',
    collaborators: { list: [anyone] },
    files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
    annotations: { list: [{ type: 'vectorial', name: 'layer', values: '', display: true }] }
  }
];
const shortnames = fixtures().map((p) => p.shortname);

// eslint-disable-next-line max-statements
describe('Admin: projects that don\'t validate (A2)', function () {
  const admin = { username: 'a2-admin', password: 'a2-admin-password' };
  const other = { username: 'a2-other', password: 'a2-other-password' };
  const owner = { username: 'a2-owner', password: 'a2-owner-password' };
  const tokens = {};
  const agents = {};
  let previousAdmins;

  const login = async (user) => {
    await U.signUp(user);
    const agent = chai.request.agent(U.getServer());
    await agent.post('/localLogin').redirects(0)
      .send(user);
    const { token } = (await agent.get('/token')).body;
    assert.isNotEmpty(token);
    agents[user.username] = agent;
    tokens[user.username] = token;
  };

  const get = (route, user = admin) => chai.request(U.serverURL).get(route)
    .query({ token: tokens[user.username] });
  const post = (route, body, user = admin) => chai.request(U.serverURL).post(route)
    .query({ token: tokens[user.username] })
    .send(body);
  const db = () => U.getDB();
  const stored = (shortname) => db().get('projects')
    .findOne({ shortname }, { projection: { _id: 0 } });
  const logs = (shortname) => db().get('log')
    .find({ key: /^admin/, 'value.shortname': shortname });

  const list = async () => {
    const res = await get('/admin/json/projects/invalid');
    assert.equal(res.status, 200, res.text);

    return res.body.list.filter((p) => shortnames.includes(p.shortname));
  };
  const entry = async (shortname) => (await list()).find((p) => p.shortname === shortname);

  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await db().get('log')
      .remove({ key: /^admin/, 'value.shortname': { $in: shortnames } });
  };

  before(async function () {
    this.timeout(U.mediumTimeout); // eslint-disable-line no-invalid-this
    previousAdmins = admins.getAdmins();
    await Promise.all([admin, other, owner].map(login));
    admins.setAdmins([admin.username]);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    await cleanup();
    await Promise.all([admin, other, owner].map((u) => U.removeLocalUser(u.username)));
  });

  beforeEach(async function () {
    await cleanup();
    await U.insertProject(fixtures());
  });

  describe('Access', function () {
    const jsonRoutes = [
      ['get', '/admin/json/projects/invalid'],
      ['post', '/admin/json/projects/remove-blank-rows'],
      ['post', '/admin/json/projects/name-layers'],
      ['post', '/admin/json/projects/restore']
    ];

    it('refuses the routes to anonymous visitors (401) and to non-admins (403)', async function () {
      for (const [method, route] of jsonRoutes) {
        /* eslint-disable no-await-in-loop */
        const anonymous = await chai.request(U.serverURL)[method](route);
        assert.equal(anonymous.status, 401, `${method} ${route} anonymous`);
        const byToken = await chai.request(U.serverURL)[method](route)
          .query({ token: tokens[other.username] });
        assert.equal(byToken.status, 403, `${method} ${route} non-admin, token`);
        const bySession = await agents[other.username][method](route);
        assert.equal(bySession.status, 403, `${method} ${route} non-admin, session`);
        /* eslint-enable no-await-in-loop */
      }
    }).timeout(U.mediumTimeout);

    it('a non-admin owner cannot run the fixes on his own project', async function () {
      const { version } = await entry('a2blank');
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version }, owner);
      assert.equal(res.status, 403);
      assert.deepEqual((await stored('a2blank')).files, fixtures()[1].files);
    }).timeout(U.shortTimeout);
  });

  describe('GET /admin/json/projects/invalid', function () {
    it('lists the projects with problems, not the valid ones', async function () {
      const names = (await list()).map((p) => p.shortname);
      assert.sameMembers(names, ['a2unnamed', 'a2blank', 'a2-odd_name', 'a2noanyone']);
    }).timeout(U.shortTimeout);

    it('gives the owner, a version, and each problem with its kind, list and row', async function () {
      const blank = await entry('a2blank');
      assert.equal(blank.owner, 'a2-owner');
      assert.equal(blank.name, 'A2 blank rows');
      assert.match(blank.version, /^[0-9a-f]{16,}$/);
      const rows = blank.problems.filter((p) => p.kind === 'warning' && p.list === 'files');
      assert.sameMembers(rows.map((p) => p.row), [1, 2, 3, 4]);
      assert.include(rows.find((p) => p.row === 1).message, 'File 2 needs a source');
      const collaborator = blank.problems.find((p) => p.list === 'collaborators');
      assert.deepInclude(collaborator, { kind: 'warning', row: 1 });
      const annotation = blank.problems.find((p) => p.list === 'annotations');
      assert.deepInclude(annotation, { kind: 'warning', row: 1 });
      const missing = blank.problems.find((p) => p.kind === 'missing user');
      assert.include(missing.users, 'voyageour');
      assert.isFalse(blank.problems.some((p) => p.kind === 'blocking'));
    }).timeout(U.shortTimeout);

    it('counts the blank rows the fix would remove: a file with an empty source whatever its name, never \'anyone\'', async function () {
      const blank = await entry('a2blank');
      assert.deepEqual(blank.blankRows, { files: 4, collaborators: 1, annotations: 1 });
      const unnamed = await entry('a2unnamed');
      assert.deepEqual(unnamed.blankRows, { files: 0, collaborators: 0, annotations: 0 });
    }).timeout(U.shortTimeout);

    it('lists the unnamed layers that have values, with a proposed unique name', async function () {
      const unnamed = await entry('a2unnamed');
      assert.deepEqual(unnamed.unnamedLayers.map((l) => l.index), [0, 2]);
      const proposed = unnamed.unnamedLayers.map((l) => l.proposed);
      assert.notInclude(proposed, 'Layer 1', 'Layer 1 is taken by the second layer');
      assert.lengthOf(new Set(proposed), 2);
      proposed.forEach((name) => assert.match(name, /^Layer \d+$/));
      assert.deepEqual(unnamed.unnamedLayers[0].values, 'Set 1');
    }).timeout(U.shortTimeout);

    it('shows a non-alphanumeric shortname and a blocking problem, with nothing to fix', async function () {
      const odd = await entry('a2-odd_name');
      assert.deepEqual(odd.problems.map((p) => p.kind).sort(), ['missing user', 'shortname']);
      assert.include(odd.problems.find((p) => p.kind === 'missing user').users, 'bountainmicycle');
      const blocked = await entry('a2noanyone');
      const blocking = blocked.problems.find((p) => p.kind === 'blocking');
      assert.include(blocking.message, 'anyone');
    }).timeout(U.shortTimeout);

    it('lists the same projects as scripts/check-projects.js (one shared module)', async function () {
      const script = path.join(__dirname, '../../scripts/check-projects.js');
      const output = await new Promise((resolve, reject) => {
        execFile(process.execPath, [script, '--db', process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test'], (err, stdout) => (err ? reject(err) : resolve(stdout)));
      });
      const listed = output.split('\n')
        .map((line) => line.match(/^(\S+) \(owner /))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((s) => shortnames.includes(s));
      assert.sameMembers(listed, (await list()).map((p) => p.shortname));
      assert.include(output, 'cannot be saved again unchanged');
      assert.include(output, 'refused: The collaborators list needs an \'anyone\' entry');
    }).timeout(U.mediumTimeout);
  });

  describe('POST /admin/json/projects/remove-blank-rows', function () {
    it('removes empty files, collaborators and annotation rows, keeps \'anyone\' and the rest, and logs the previous document', async function () {
      const { version } = await entry('a2blank');
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.removed, { files: 4, collaborators: 1, annotations: 1 });
      assert.isString(res.body.log);
      assert.notEqual(res.body.version, version);

      const after = await stored('a2blank');
      const [, before] = fixtures();
      assert.deepEqual(after.files.list, [before.files.list[0]]);
      assert.deepEqual(after.collaborators.list, [before.collaborators.list[0], before.collaborators.list[2]]);
      assert.deepEqual(after.annotations.list, [before.annotations.list[0]]);
      assert.equal(after.owner, before.owner);

      const [logged] = await logs('a2blank');
      assert.equal(logged.key, 'adminRemoveBlankRows');
      assert.equal(String(logged._id), res.body.log);
      assert.equal(logged.value.username, admin.username);
      assert.deepEqual(logged.value.project.files, before.files);
      assert.deepEqual(logged.value.project.collaborators, before.collaborators);

      // listed again only for what is left: the user that does not exist
      const now = await entry('a2blank');
      assert.deepEqual(now.problems.map((p) => p.kind), ['missing user']);
      assert.deepEqual(now.blankRows, { files: 0, collaborators: 0, annotations: 0 });
    }).timeout(U.shortTimeout);

    it('refuses with 409 if the project changed since it was listed, and changes nothing', async function () {
      const { version } = await entry('a2blank');
      await db().get('projects')
        .update({ shortname: 'a2blank' }, { $set: { description: 'changed by its owner' } });
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(res.status, 409);
      assert.lengthOf((await stored('a2blank')).files.list, 5);
      assert.lengthOf(await logs('a2blank'), 0);
    }).timeout(U.shortTimeout);

    it('answers 400 without a version, 404 for an unknown project, 409 with nothing to remove', async function () {
      let res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank' });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2nosuchproject', version: '0123456789abcdef' });
      assert.equal(res.status, 404);
      const { version } = await entry('a2unnamed');
      res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2unnamed', version });
      assert.equal(res.status, 409);
    }).timeout(U.shortTimeout);

    it('saves through the validation of normal saves: a project that would be refused is not changed (400)', async function () {
      const { version } = await entry('a2noanyone');
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2noanyone', version });
      assert.equal(res.status, 400);
      assert.include(res.body.error, 'anyone');
      assert.lengthOf((await stored('a2noanyone')).files.list, 1);
      assert.lengthOf(await logs('a2noanyone'), 0);
    }).timeout(U.shortTimeout);

    it('waits for the project lock', async function () {
      const { version } = await entry('a2blank');
      let release;
      const held = lock.withProjectLock('a2blank', () => new Promise((resolve) => { release = resolve; }));
      const action = post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      const settled = await Promise.race([
        action.then(() => 'settled'),
        new Promise((resolve) => { setTimeout(() => resolve('pending'), 300); })
      ]);
      assert.equal(settled, 'pending');
      assert.lengthOf((await stored('a2blank')).files.list, 5);
      release();
      await held;
      assert.equal((await action).status, 200);
    }).timeout(U.shortTimeout);
  });

  describe('POST /admin/json/projects/name-layers', function () {
    it('names the unnamed layers, sanitised, and logs the previous document', async function () {
      const { version } = await entry('a2unnamed');
      const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: '<b>Cortex</b>', 2: 'Notes' } });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.named, 2);
      const after = await stored('a2unnamed');
      assert.deepEqual(after.annotations.list.map((a) => a.name), ['Cortex', 'Layer 1', 'Notes']);
      assert.deepEqual(after.annotations.list.map((a) => a.values), ['Set 1', 'Set 2', 'free text']);
      const [logged] = await logs('a2unnamed');
      assert.equal(logged.key, 'adminNameLayers');
      assert.deepEqual(logged.value.project.annotations, fixtures()[0].annotations);
      assert.isUndefined(await entry('a2unnamed'), 'the project validates now');
    }).timeout(U.shortTimeout);

    it('refuses empty, duplicate and already-named layers (400), and a changed project (409)', async function () {
      const { version } = await entry('a2unnamed');
      const cases = [
        { 0: '  ' },
        { 0: '<i></i>' },
        { 0: 'Layer 1' },
        { 0: 'Same', 2: 'same' },
        { 1: 'Renamed' },
        { 7: 'Nowhere' },
        {}
      ];
      for (const names of cases) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names });
        assert.equal(res.status, 400, JSON.stringify(names));
      }
      assert.deepEqual((await stored('a2unnamed')).annotations, fixtures()[0].annotations);
      await db().get('projects')
        .update({ shortname: 'a2unnamed' }, { $set: { name: 'renamed meanwhile' } });
      const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex' } });
      assert.equal(res.status, 409);
      assert.lengthOf(await logs('a2unnamed'), 0);
    }).timeout(U.mediumTimeout);
    // F1: the save check and this fix use one function: a stored duplicate
    // does not block naming another layer, a new name may not repeat one
    it('agrees with project saves on duplicate names: stored duplicates are accepted, new ones refused', async function () {
      await db().get('projects')
        .update({ shortname: 'a2unnamed' }, { $push: { 'annotations.list': { type: 'vectorial', name: 'layer 1 ', values: '', display: true } } });
      const { version } = await entry('a2unnamed');
      let res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'LAYER 1' } });
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await stored('a2unnamed')).annotations.list.map((a) => a.name), ['Cortex', 'Layer 1', 'Notes', 'layer 1 ']);
    }).timeout(U.shortTimeout);
  });

  describe('POST /admin/json/projects/restore', function () {
    it('puts back the logged version, once', async function () {
      const { version } = await entry('a2blank');
      const original = await stored('a2blank');
      const removed = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(removed.status, 200);

      let res = await post('/admin/json/projects/restore', { log: removed.body.log });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await stored('a2blank'), original);
      assert.equal(res.body.version, version);
      const restoreLog = (await logs('a2blank')).find((l) => l.key === 'adminRestoreProject');
      assert.equal(restoreLog.value.restored, removed.body.log);

      res = await post('/admin/json/projects/restore', { log: removed.body.log });
      assert.equal(res.status, 409, 'restored already');
    }).timeout(U.shortTimeout);

    it('refuses (409) if the project changed since the action', async function () {
      const { version } = await entry('a2unnamed');
      const named = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(named.status, 200);
      await db().get('projects')
        .update({ shortname: 'a2unnamed' }, { $set: { description: 'edited after the fix' } });
      const res = await post('/admin/json/projects/restore', { log: named.body.log });
      assert.equal(res.status, 409);
      assert.equal((await stored('a2unnamed')).annotations.list[0].name, 'Cortex');
    }).timeout(U.shortTimeout);

    it('answers 400 without a log id and 404 for an unknown one', async function () {
      let res = await post('/admin/json/projects/restore', {});
      assert.equal(res.status, 400);
      res = await post('/admin/json/projects/restore', { log: '0123456789abcdef01234567' });
      assert.equal(res.status, 404);
      res = await post('/admin/json/projects/restore', { log: 'not-an-id' });
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });
});
