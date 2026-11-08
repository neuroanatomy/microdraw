/* eslint-disable max-lines, max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const _ = require('lodash');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { ObjectId } = require('neuroweblab');
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const adminProjects = require('../../app/controller/admin/admin.projects');
const lock = require('../../app/controller/projectLock');
const { projectVersion } = require('../../app/controller/project/project.check');

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
  const stored = (shortname) => db().collection('projects')
    .findOne({ shortname }, { projection: { _id: 0 } });
  const logs = (shortname) => db().collection('log')
    .find({ key: /^admin/, 'value.shortname': shortname })
    .toArray();

  const script = path.join(__dirname, '../../scripts/check-projects.js');
  const runScript = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  const testDb = process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test';

  const list = async () => {
    const res = await get('/admin/json/projects/invalid');
    assert.equal(res.status, 200, res.text);

    return res.body.list.filter((p) => shortnames.includes(p.shortname));
  };
  const entry = async (shortname) => (await list()).find((p) => p.shortname === shortname);

  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await db().collection('log')
      .deleteMany({ key: /^admin/, 'value.shortname': { $in: shortnames } });
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
      const { code, stdout: output } = await runScript(['--db', testDb]);
      assert.equal(code, 0);
      const listed = output.split('\n')
        .map((line) => line.match(/^(\S+) \(owner /))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((s) => shortnames.includes(s));
      assert.sameMembers(listed, (await list()).map((p) => p.shortname));
      assert.include(output, 'cannot be saved again unchanged');
      assert.include(output, 'refused: The collaborators list needs an \'anyone\' entry');
    }).timeout(U.mediumTimeout);

    it('counts the stored projects and the refused ones, without the backups', async function () {
      const counts = async () => {
        const { body } = await get('/admin/json/projects/invalid');

        return { total: body.total, refused: body.refused, listed: body.list.filter((p) => p.shortname === 'a2noanyone').length };
      };
      const before = await counts();
      assert.equal(before.total, await db().collection('projects')
        .countDocuments({ backup: { $exists: false } }));
      assert.isAtLeast(before.refused, 1);
      assert.equal(before.listed, 1);

      const [, , , refusedProject] = fixtures();
      assert.equal(refusedProject.shortname, 'a2noanyone');
      await U.insertProject({ ...refusedProject, backup: true });
      assert.deepEqual(await counts(), before);

      await U.insertProject({ ...refusedProject });
      assert.deepEqual(await counts(), { total: before.total + 1, refused: before.refused + 1, listed: 2 });
    }).timeout(U.shortTimeout);

    it('the script prints only the list and its count', async function () {
      const { stdout } = await runScript(['--db', testDb]);
      const { body } = await get('/admin/json/projects/invalid');
      const lines = stdout.split('\n').filter(Boolean);
      assert.equal(lines.pop(), `${body.total} projects, ${body.refused} cannot be saved again unchanged.`);
      for (const line of lines) {
        assert.match(line, /^(\S+ \(owner .*\):| {2}- .+)$/);
      }
    }).timeout(U.mediumTimeout);

    it('the script exits with 2 and its usage without --db', async function () {
      const { code, stdout, stderr } = await runScript([]);
      assert.equal(code, 2);
      assert.equal(stdout, '');
      assert.include(stderr, 'Usage: node scripts/check-projects.js --db');
    }).timeout(U.mediumTimeout);

    it('the script exits with 1 and says so if it cannot connect', async function () {
      const { code, stdout, stderr } = await runScript(['--db', '127.0.0.1:1/nothing?serverSelectionTimeoutMS=200']);
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(stderr, /^Cannot connect to the database: /);
    }).timeout(U.mediumTimeout);

    it('reads through the native driver', async function () {
      const res = await get('/admin/json/projects/invalid');
      assert.equal(res.status, 200, res.text);
      assert.isAtLeast(res.body.total, 1);
    }).timeout(U.shortTimeout);

    it('a version listed is the one a fix computes, whatever the stored types', async function () {
      await db().collection('projects')
        .updateOne(
          { shortname: 'a2blank' },
          { $set: { date: new Date(0), id: new ObjectId('0123456789abcdef01234567'), numbers: [1, 1.5, null, 2 ** 40] } }
        );
      const { version } = await entry('a2blank');
      assert.equal(version, projectVersion(await db().collection('projects')
        .findOne({ shortname: 'a2blank' })));
    }).timeout(U.shortTimeout);
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
      await db().collection('projects')
        .updateOne({ shortname: 'a2blank' }, { $set: { description: 'changed by its owner' } });
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

  describe('the validation of a fix', function () {
    it('checks the users through the native driver', async function () {
      const { version } = await entry('a2blank');
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(res.status, 200, res.text);
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
      await db().collection('projects')
        .updateOne({ shortname: 'a2unnamed' }, { $set: { name: 'renamed meanwhile' } });
      const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex' } });
      assert.equal(res.status, 409);
      assert.lengthOf(await logs('a2unnamed'), 0);
    }).timeout(U.mediumTimeout);
    // F1: the save check and this fix use one function: a stored duplicate
    // does not block naming another layer, a new name may not repeat one
    it('agrees with project saves on duplicate names: stored duplicates are accepted, new ones refused', async function () {
      await db().collection('projects')
        .updateOne({ shortname: 'a2unnamed' }, { $push: { 'annotations.list': { type: 'vectorial', name: 'layer 1 ', values: '', display: true } } });
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
      await db().collection('projects')
        .updateOne({ shortname: 'a2unnamed' }, { $set: { description: 'edited after the fix' } });
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

  // What the fixes and restore leave in the database, read through the
  // native driver: the project document (same ObjectId), and the `log`
  // entries, { key, value, date }, with value.before and value.after.
  describe('What ends in the database', function () {
    const native = () => U.getNativeDB();
    const doc = (shortname) => native().collection('projects')
      .findOne({ shortname, backup: { $exists: false } });
    const logEntry = (id) => native().collection('log')
      .findOne({ _id: new ObjectId(id) });
    const keyLogs = (key, shortname) => native().collection('log')
      .find({ key, 'value.shortname': shortname })
      .toArray();
    const isoDate = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
    // what changeProject and restoreProject need of NWL's database
    const appDb = { nativeMongoDB: () => U.getNativeDB() };
    const assertSameDocument = (actual, expected) => {
      assert.instanceOf(actual._id, ObjectId);
      assert.equal(String(actual._id), String(expected._id));
      assert.deepEqual(_.omit(actual, ['_id']), _.omit(expected, ['_id']));
    };

    it('a fix logs { key, value, date }: the previous document, both versions, under an ObjectId', async function () {
      const before = await doc('a2blank');
      const { version } = await entry('a2blank');
      const res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(res.status, 200, res.text);

      const logged = await logEntry(res.body.log);
      assert.instanceOf(logged._id, ObjectId);
      assert.deepEqual(Object.keys(logged), ['_id', 'key', 'value', 'date']);
      assert.equal(logged.key, 'adminRemoveBlankRows');
      assert.match(logged.date, isoDate);
      assert.deepEqual(Object.keys(logged.value), ['username', 'shortname', 'before', 'removed', 'project', 'after']);
      assert.deepEqual(_.omit(logged.value, ['project']), {
        username: admin.username,
        shortname: 'a2blank',
        before: version,
        removed: { files: 4, collaborators: 1, annotations: 1 },
        after: res.body.version
      });
      assert.deepEqual(logged.value.project, _.omit(before, ['_id']));

      const after = await doc('a2blank');
      assert.instanceOf(after._id, ObjectId);
      assert.equal(String(after._id), String(before._id));
      assert.equal(res.body.version, projectVersion(after));
    }).timeout(U.shortTimeout);

    it('naming layers logs the names, and value.after is the version of the saved project', async function () {
      const before = await doc('a2unnamed');
      const { version } = await entry('a2unnamed');
      const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(res.status, 200, res.text);
      const logged = await logEntry(res.body.log);
      assert.deepEqual(Object.keys(logged.value), ['username', 'shortname', 'before', 'named', 'names', 'project', 'after']);
      assert.deepEqual(_.omit(logged.value, ['project']), {
        username: admin.username,
        shortname: 'a2unnamed',
        before: version,
        named: 2,
        names: { 0: 'Cortex', 2: 'Notes' },
        after: projectVersion(await doc('a2unnamed'))
      });
      assert.deepEqual(logged.value.project, _.omit(before, ['_id']));
      assert.equal(String((await doc('a2unnamed'))._id), String(before._id));
    }).timeout(U.shortTimeout);

    it('restore puts back the logged document under the same ObjectId, and logs the one it replaced', async function () {
      const before = await doc('a2unnamed');
      const { version } = await entry('a2unnamed');
      const named = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(named.status, 200, named.text);
      const fixed = await doc('a2unnamed');
      const fixLog = await logEntry(named.body.log);

      const res = await post('/admin/json/projects/restore', { log: named.body.log });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.version, version);
      assertSameDocument(await doc('a2unnamed'), before);

      const [logged] = await keyLogs('adminRestoreProject', 'a2unnamed');
      assert.instanceOf(logged._id, ObjectId);
      assert.deepEqual(Object.keys(logged), ['_id', 'key', 'value', 'date']);
      assert.match(logged.date, isoDate);
      assert.deepEqual(Object.keys(logged.value), ['username', 'shortname', 'restored', 'project']);
      assert.deepEqual(logged.value, {
        username: admin.username,
        shortname: 'a2unnamed',
        restored: named.body.log,
        project: _.omit(fixed, ['_id'])
      });
      assert.deepEqual(await logEntry(named.body.log), fixLog, 'the fix\'s entry is left as it was');
    }).timeout(U.shortTimeout);

    it('changeProject with its own save; restore removes a field the change added', async function () {
      const before = await doc('a2clean');
      const result = await adminProjects.changeProject(appDb, {
        shortname: 'a2clean',
        version: projectVersion(before),
        username: admin.username,
        key: 'adminNameLayers',
        change: (project) => ({ data: project, details: { named: 0 } }),
        save: () => Promise.resolve({ write: () => native().collection('projects')
          .updateOne({ shortname: 'a2clean', backup: { $exists: false } }, { $set: { extra: 'added by the change' } }) })
      });
      assert.deepEqual(Object.keys(result), ['named', 'version', 'log']);
      const changed = await doc('a2clean');
      assert.equal(changed.extra, 'added by the change');
      assert.equal(result.version, projectVersion(changed));
      assert.equal((await logEntry(result.log)).value.after, result.version);

      const restored = await adminProjects.restoreProject(appDb, { logId: result.log, username: admin.username });
      assert.deepEqual(restored, { version: projectVersion(before) });
      assertSameDocument(await doc('a2clean'), before);
    }).timeout(U.shortTimeout);

    it('changeProject writes nothing when the project is missing or changed, or the change or the save refuses', async function () {
      const before = await doc('a2clean');
      const params = {
        shortname: 'a2clean',
        version: projectVersion(before),
        username: admin.username,
        key: 'adminNameLayers',
        change: (project) => ({ data: project, details: {} })
      };
      const refusedSave = () => Promise.resolve({ status: 400, error: 'refused by the save' });
      const answers = [
        await adminProjects.changeProject(appDb, { ...params, shortname: 'a2nosuchproject' }),
        await adminProjects.changeProject(appDb, { ...params, version: 'not the version' }),
        await adminProjects.changeProject(appDb, { ...params, change: () => ({ status: 400, error: 'refused by the change' }) }),
        await adminProjects.changeProject(appDb, { ...params, save: refusedSave })
      ];
      assert.deepEqual(answers.map((a) => a.status), [404, 409, 400, 400]);
      assert.deepEqual(answers[3], { status: 400, error: 'refused by the save' });
      assertSameDocument(await doc('a2clean'), before);
      assert.lengthOf(await keyLogs('adminNameLayers', 'a2clean'), 0);
    }).timeout(U.shortTimeout);

    it('a fix refused for a changed version (409) leaves the project and the log as they were', async function () {
      const { version } = await entry('a2unnamed');
      await native().collection('projects')
        .updateOne({ shortname: 'a2unnamed' }, { $set: { description: 'changed by its owner' } });
      const edited = await doc('a2unnamed');
      let res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex' } });
      assert.equal(res.status, 409);
      res = await post('/admin/json/projects/remove-blank-rows', { project: 'a2unnamed', version });
      assert.equal(res.status, 409);
      assertSameDocument(await doc('a2unnamed'), edited);
      assert.lengthOf(await logs('a2unnamed'), 0);
    }).timeout(U.shortTimeout);

    it('restore after an edit (409), or a second time (409), leaves the project as it is and logs nothing', async function () {
      const { version } = await entry('a2blank');
      const fixed = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(fixed.status, 200, fixed.text);
      await native().collection('projects')
        .updateOne({ shortname: 'a2blank' }, { $set: { description: 'edited after the fix' } });
      const edited = await doc('a2blank');
      let res = await post('/admin/json/projects/restore', { log: fixed.body.log });
      assert.equal(res.status, 409);
      assertSameDocument(await doc('a2blank'), edited);
      assert.lengthOf(await keyLogs('adminRestoreProject', 'a2blank'), 0);

      await native().collection('projects')
        .updateOne({ shortname: 'a2blank' }, { $unset: { description: '' } });
      res = await post('/admin/json/projects/restore', { log: fixed.body.log });
      assert.equal(res.status, 200, res.text);
      const restored = await doc('a2blank');
      res = await post('/admin/json/projects/restore', { log: fixed.body.log });
      assert.equal(res.status, 409);
      assertSameDocument(await doc('a2blank'), restored);
      assert.lengthOf(await keyLogs('adminRestoreProject', 'a2blank'), 1);
    }).timeout(U.shortTimeout);

    it('restore answers 404 for an unknown, a capitalised, another action\'s or a malformed log id, and changes nothing', async function () {
      const { version } = await entry('a2blank');
      const fixed = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version });
      assert.equal(fixed.status, 200, fixed.text);
      const afterFix = await doc('a2blank');
      const { insertedId } = await native().collection('log')
        .insertOne({ key: 'adminRemoveOrphans', value: { shortname: 'a2blank' }, date: (new Date()).toJSON() });
      // one letter in capitals: ObjectId and toId would find the entry
      const capitalised = fixed.body.log.replace(/[a-f](?=[^a-f]*$)/, (c) => c.toUpperCase());
      assert.notEqual(capitalised, fixed.body.log);
      const bad = [
        '0123456789abcdef01234567',
        fixed.body.log.toUpperCase(),
        capitalised,
        String(insertedId),
        'not-an-id',
        'zzzzzzzzzzzzzzzzzzzzzzzz',
        `${fixed.body.log}0`,
        fixed.body.log.slice(1)
      ];
      for (const log of bad) {
        // eslint-disable-next-line no-await-in-loop
        const res = await post('/admin/json/projects/restore', { log });
        assert.equal(res.status, 404, log);
      }
      assertSameDocument(await doc('a2blank'), afterFix);
      assert.lengthOf(await keyLogs('adminRestoreProject', 'a2blank'), 0);
      const res = await post('/admin/json/projects/restore', { log: fixed.body.log });
      assert.equal(res.status, 200, res.text);
    }).timeout(U.mediumTimeout);

    // Before 3cd20a4 (read through the legacy driver, saved through NWL's
    // native upsertProject), a project holding an ObjectId gave 500
    // (BSONVersionError)
    it('fixes a project that holds an ObjectId, and keeps it one', async function () {
      const held = new ObjectId('0123456789abcdef01234567');
      await native().collection('projects')
        .updateOne({ shortname: 'a2unnamed' }, { $set: { ref: held } });
      const { version } = await entry('a2unnamed');
      const res = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(res.status, 200, res.text);
      const after = await doc('a2unnamed');
      assert.instanceOf(after.ref, ObjectId);
      assert.equal(String(after.ref), String(held));
      assert.instanceOf((await logEntry(res.body.log)).value.project.ref, ObjectId);
      const undo = await post('/admin/json/projects/restore', { log: res.body.log });
      assert.equal(undo.status, 200, undo.text);
      assert.equal(undo.body.version, version);
      assert.instanceOf((await doc('a2unnamed')).ref, ObjectId);
    }).timeout(U.shortTimeout);

    it('fixes and restores, one after the other', async function () {
      const blank = await entry('a2blank');
      const removed = await post('/admin/json/projects/remove-blank-rows', { project: 'a2blank', version: blank.version });
      assert.equal(removed.status, 200, removed.text);
      const unnamed = await entry('a2unnamed');
      const named = await post('/admin/json/projects/name-layers', { project: 'a2unnamed', version: unnamed.version, names: { 0: 'Cortex', 2: 'Notes' } });
      assert.equal(named.status, 200, named.text);
      const restored = await post('/admin/json/projects/restore', { log: removed.body.log });
      assert.equal(restored.status, 200, restored.text);
    }).timeout(U.shortTimeout);
  });
});
