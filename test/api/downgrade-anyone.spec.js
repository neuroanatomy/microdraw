/* eslint-disable max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const _ = require('lodash');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const { downgradeAnyone } = require('../../scripts/downgrade-anyone');

// scripts/downgrade-anyone.js (maintainer, 2026-11-15): the 'anyone' row's
// rights above view become view in every current project; none and view are
// kept, and so are the named collaborators' rows and backup versions. Dry run
// by default; a second apply changes nothing.
describe('Downgrade of the anyone rights', function () {
  const PREFIX = 'downgradeanyone';
  const match = new RegExp(`^${PREFIX}`);
  const script = path.join(__dirname, '../../scripts/downgrade-anyone.js');
  const testDb = process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test';

  const db = () => U.getNativeDB();
  const projects = () => db().collection('projects');
  const runScript = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

  const row = (username, files, annotations, collaborators, key = 'username') => ({ [key]: username, access: { files, annotations, collaborators } });
  const project = (shortname, list, extra = {}) => ({
    name: shortname,
    shortname,
    owner: 'alice',
    collaborators: { list },
    files: { list: [] },
    annotations: { list: [] },
    ...extra
  });
  const fixtures = () => [
    // the usual public project: anyone may draw
    project(`${PREFIX}public`, [row('anyone', 'view', 'edit', 'view'), row('bob', 'view', 'remove', 'remove')]),
    // anyone may do everything, keyed by userID only
    project(`${PREFIX}open`, [row('anyone', 'remove', 'add', 'edit', 'userID')]),
    // invisible to anyone: kept
    project(`${PREFIX}private`, [row('anyone', 'none', 'none', 'none'), row('carol', 'edit', 'edit', 'edit')]),
    // a backup version, never changed
    project(`${PREFIX}public`, [row('anyone', 'view', 'edit', 'view')], { backup: true })
  ];
  const accessOf = async (shortname, username, backup = false) => {
    const doc = await projects().findOne({ shortname, backup: { $exists: backup } });

    return doc.collaborators.list.find((c) => (c.username || c.userID) === username).access;
  };

  beforeEach(async function () {
    await projects().deleteMany({ shortname: { $regex: match } });
    await projects().insertMany(fixtures());
  });

  after(async function () {
    await projects().deleteMany({ shortname: { $regex: match } });
  });

  it('exits with its usage without --db', async function () {
    const { code, stderr } = await runScript([]);
    assert.equal(code, 2);
    assert.include(stderr, 'Usage: node scripts/downgrade-anyone.js --db');
  }).timeout(U.mediumTimeout);

  it('dry run (the default) prints what it would change and writes nothing', async function () {
    const lines = [];
    const summary = await downgradeAnyone(db(), { match, print: (line) => lines.push(line) });
    assert.deepEqual(summary, { projects: 3, withAnyone: 3, projectsChanged: 2, rights: 4, errors: 0 });
    const out = lines.join('\n');
    assert.include(out, `${PREFIX}public: anyone annotations edit → would set view`);
    assert.include(out, `${PREFIX}open: anyone files remove, annotations add, collaborators edit → would set view`);
    assert.include(out, '4 rights to set to view in 2 projects (dry run, nothing written)');
    assert.deepEqual(await accessOf(`${PREFIX}public`, 'anyone'), { files: 'view', annotations: 'edit', collaborators: 'view' });
  });

  it('the command line dry run writes nothing', async function () {
    const { code, stdout } = await runScript(['--db', testDb]);
    assert.equal(code, 0, stdout);
    assert.include(stdout, `${PREFIX}public: anyone annotations edit → would set view`);
    assert.deepEqual(await accessOf(`${PREFIX}open`, 'anyone'), { files: 'remove', annotations: 'add', collaborators: 'edit' });
  }).timeout(U.mediumTimeout);

  it('apply sets anyone\'s rights above view to view, only those; a second apply changes nothing', async function () {
    const before = await projects().findOne({ shortname: `${PREFIX}public`, backup: { $exists: false } });
    const first = await downgradeAnyone(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(first, { projectsChanged: 2, rights: 4, errors: 0 });
    assert.deepEqual(await accessOf(`${PREFIX}public`, 'anyone'), { files: 'view', annotations: 'view', collaborators: 'view' });
    assert.deepEqual(await accessOf(`${PREFIX}open`, 'anyone'), { files: 'view', annotations: 'view', collaborators: 'view' });
    assert.deepEqual(await accessOf(`${PREFIX}private`, 'anyone'), { files: 'none', annotations: 'none', collaborators: 'none' }, 'invisible to anyone: kept');
    assert.deepEqual(await accessOf(`${PREFIX}public`, 'bob'), { files: 'view', annotations: 'remove', collaborators: 'remove' }, 'named collaborators kept');
    assert.deepEqual(await accessOf(`${PREFIX}public`, 'anyone', true), { files: 'view', annotations: 'edit', collaborators: 'view' }, 'backups kept');
    const after = await projects().findOne({ shortname: `${PREFIX}public`, backup: { $exists: false } });
    assert.equal(String(after._id), String(before._id), 'in place: same version');

    const second = await downgradeAnyone(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(second, { projectsChanged: 0, rights: 0 });
  });
});
