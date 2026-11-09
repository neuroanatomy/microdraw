/* eslint-disable max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const _ = require('lodash');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const { saveProjectVersion } = require('../../app/controller/project/currentProject');
const { applyPlan, migrateProjects, planMigration } = require('../../scripts/migrate-projects');

// T002 2.4: scripts/migrate-projects.js gives collaborator rows stored with
// one key both `username` and `userID`, equal, in a new version of the
// project that keeps `modified`/`modifiedBy`; rows whose keys differ or that
// name nobody are reported, not changed. Dry run by default.
describe('Stored-project migration: both collaborator keys (T002 2.4)', function () {
  const PREFIX = 'migrate24';
  const match = new RegExp(`^${PREFIX}`);
  const script = path.join(__dirname, '../../scripts/migrate-projects.js');
  const testDb = process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test';
  const access = { collaborators: 'view', annotations: 'view', files: 'view' };
  const modified = '2025-01-02T03:04:05.000Z';

  const db = () => U.getNativeDB();
  const projects = () => db().collection('projects');
  const versions = (shortname) => projects().find({ shortname }, { sort: { _id: 1 } })
    .toArray();
  const ours = () => projects().find({ shortname: { $regex: match } }, { sort: { _id: 1 } })
    .toArray();
  const runScript = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  const quiet = { apply: true, match, print: _.noop };

  const project = (shortname, list, extra = {}) => ({
    name: shortname,
    shortname,
    url: '',
    created: '2024-01-01T00:00:00.000Z',
    owner: `${PREFIX}-owner`,
    collaborators: { list },
    files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
    annotations: { list: [] },
    ...extra
  });

  // stored before 2.2: one key per row, with modified/modifiedBy
  const oneKey = () => project(`${PREFIX}onekey`, [
    { username: 'anyone', access },
    { username: `${PREFIX}-alice`, access },
    { userID: `${PREFIX}-bob`, access },
    { username: `${PREFIX}-carol`, userID: `${PREFIX}-carol`, access }
  ], { modified, modifiedBy: `${PREFIX}-alice` });
  // rows reported, not changed; one row to change; no modified stored
  const odd = () => project(`${PREFIX}odd`, [
    { username: 'anyone', userID: 'anyone', access },
    { username: `${PREFIX}-dan`, userID: `${PREFIX}-eve`, access },
    { username: '', access },
    { username: `${PREFIX}-fay`, access }
  ]);
  // nothing to do
  const done = () => project(`${PREFIX}done`, [{ username: 'anyone', userID: 'anyone', access }]);

  const reset = async () => {
    await projects().deleteMany({ shortname: { $regex: match } });
    await projects().insertMany([oneKey(), odd(), done()]);
  };

  beforeEach(async function () {
    await reset();
  });

  after(async function () {
    await projects().deleteMany({ shortname: { $regex: match } });
  });

  it('exits with its usage without --db', async function () {
    const { code, stderr } = await runScript([]);
    assert.equal(code, 2);
    assert.include(stderr, 'Usage: node scripts/migrate-projects.js --db');
  }).timeout(U.mediumTimeout);

  it('dry run (the default) prints the rows to change and writes nothing', async function () {
    const before = await ours();
    const { code, stdout } = await runScript(['--db', testDb]);
    assert.equal(code, 0, stdout);
    assert.include(stdout, `${PREFIX}onekey (owner ${PREFIX}-owner)`);
    assert.include(stdout, `row 2: {"username":"${PREFIX}-alice"} -> {"username":"${PREFIX}-alice","userID":"${PREFIX}-alice"}`);
    assert.notInclude(stdout, `${PREFIX}done (owner`);
    assert.match(stdout, /\d+ projects scanned, \d+ to change \(\d+ rows; dry run, nothing written\)/);
    assert.deepEqual(await ours(), before);
  }).timeout(U.mediumTimeout);

  it('dry run summary counts projects, rows and reported rows', async function () {
    const lines = [];
    const summary = await migrateProjects(db(), { match, print: (line) => lines.push(line) });
    assert.deepInclude(summary, { scanned: 3, changed: 2, skipped: 0, reported: 2, rows: 4, errors: 0 });
    assert.include(lines.join('\n'), '3 projects scanned, 2 to change (4 rows; dry run, nothing written), 0 skipped, 2 rows reported, 0 errors.');
    assert.lengthOf(await ours(), 3);
  });

  it('apply adds the missing key to one-key rows only', async function () {
    await migrateProjects(db(), quiet);
    const [, current] = await versions(`${PREFIX}onekey`);
    assert.deepEqual(current.collaborators.list, [
      { username: 'anyone', userID: 'anyone', access },
      { username: `${PREFIX}-alice`, userID: `${PREFIX}-alice`, access },
      { userID: `${PREFIX}-bob`, username: `${PREFIX}-bob`, access },
      { username: `${PREFIX}-carol`, userID: `${PREFIX}-carol`, access }
    ]);
  });

  it('apply reports differing and empty rows and leaves them unchanged', async function () {
    const lines = [];
    await migrateProjects(db(), { ...quiet, print: (line) => lines.push(line) });
    const output = lines.join('\n');
    assert.include(output, `row 2 has a different username (${PREFIX}-dan) and userID (${PREFIX}-eve): reported, not changed`);
    assert.include(output, 'row 3 names nobody: {"username":"","access":');
    const [, current] = await versions(`${PREFIX}odd`);
    assert.deepEqual(current.collaborators.list, [
      { username: 'anyone', userID: 'anyone', access },
      { username: `${PREFIX}-dan`, userID: `${PREFIX}-eve`, access },
      { username: '', access },
      { username: `${PREFIX}-fay`, userID: `${PREFIX}-fay`, access }
    ]);
  });

  it('apply makes one new version per changed project, the old one kept as backup', async function () {
    const summary = await migrateProjects(db(), quiet);
    assert.deepInclude(summary, { scanned: 3, changed: 2, skipped: 0, reported: 2, rows: 4, errors: 0 });
    for (const [make, shortname] of [[oneKey, `${PREFIX}onekey`], [odd, `${PREFIX}odd`]]) {
      const [old, current, ...more] = await versions(shortname); // eslint-disable-line no-await-in-loop
      assert.isEmpty(more);
      assert.isTrue(old.backup);
      assert.deepEqual(_.omit(old, ['_id', 'backup']), make());
      assert.notProperty(current, 'backup');
      assert.deepEqual(_.omit(current, ['_id', 'collaborators']), _.omit(make(), 'collaborators'));
    }
    const unchanged = await versions(`${PREFIX}done`);
    assert.lengthOf(unchanged, 1);
    assert.notProperty(unchanged[0], 'backup');
  });

  it('apply keeps modified and modifiedBy (and their absence)', async function () {
    await migrateProjects(db(), quiet);
    const [, current] = await versions(`${PREFIX}onekey`);
    assert.equal(current.modified, modified);
    assert.equal(current.modifiedBy, `${PREFIX}-alice`);
    const [, other] = await versions(`${PREFIX}odd`);
    assert.notProperty(other, 'modified');
    assert.notProperty(other, 'modifiedBy');
  });

  it('skips a project changed between the read and the write', async function () {
    const plan = await planMigration(db(), { match });
    // a save by the live app meanwhile
    const stored = await projects().findOne({ shortname: `${PREFIX}onekey` });
    const saved = await saveProjectVersion(db(), { ...stored, name: 'Saved meanwhile' }, { by: `${PREFIX}-alice` });
    const result = await applyPlan(db(), plan);
    assert.deepEqual(result.skipped, [`${PREFIX}onekey`]);
    assert.deepEqual(result.changed, [`${PREFIX}odd`]);
    const all = await versions(`${PREFIX}onekey`);
    assert.lengthOf(all, 2);
    assert.equal(String(all[1]._id), String(saved._id));
    assert.notProperty(all[1], 'backup');
    assert.deepEqual(all[1].collaborators.list, oneKey().collaborators.list);
  });

  it('a second run changes nothing', async function () {
    await migrateProjects(db(), quiet);
    const before = await ours();
    const summary = await migrateProjects(db(), quiet);
    assert.deepInclude(summary, { scanned: 3, changed: 0, skipped: 0, rows: 0, errors: 0 });
    assert.deepEqual(await ours(), before);
  });
});
