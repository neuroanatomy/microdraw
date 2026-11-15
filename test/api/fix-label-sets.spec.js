/* eslint-disable max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const _ = require('lodash');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const { fixLabelSets } = require('../../scripts/fix-label-sets');

// scripts/fix-label-sets.js (maintainer, 2026-11-15): the vectorial layers of
// current projects whose label set doesn't exist ('Set I', 'set1.json', '',
// null, missing) get '10regions.json', what the viewer already uses. Known
// files and names, text layers and backup versions are not changed. Dry run by
// default; a second apply changes nothing.
describe('Fix of the stub label sets', function () {
  const PREFIX = 'fixlabelsets';
  const match = new RegExp(`^${PREFIX}`);
  const script = path.join(__dirname, '../../scripts/fix-label-sets.js');
  const testDb = process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test';

  const db = () => U.getNativeDB();
  const projects = () => db().collection('projects');
  const runScript = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

  const layer = (name, values, type = 'vectorial') => (typeof values === 'undefined' ? { type, name } : { type, name, values });
  const project = (shortname, layers, extra = {}) => ({
    name: shortname,
    shortname,
    url: '',
    owner: 'alice',
    collaborators: { list: [] },
    files: { list: [] },
    annotations: { list: layers },
    ...extra
  });
  const fixtures = () => [
    project(`${PREFIX}stubs`, [
      layer('A', 'Set I'),
      layer('B', 'set1.json'),
      layer('C', ''),
      layer('D', null),
      layer('E'),
      layer('Notes', '', 'text')
    ]),
    project(`${PREFIX}known`, [layer('A', '10regions.json'), layer('B', '20 regions')]),
    // a backup version, never changed
    project(`${PREFIX}stubs`, [layer('A', 'Set I')], { backup: true })
  ];
  const valuesOf = async (shortname, backup = false) => {
    const doc = await projects().findOne({ shortname, backup: { $exists: backup } });

    return doc.annotations.list.map((l) => (typeof l.values === 'undefined' ? '<missing>' : l.values));
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
    assert.include(stderr, 'Usage: node scripts/fix-label-sets.js --db');
  }).timeout(U.mediumTimeout);

  it('dry run (the default) prints what it would change and writes nothing', async function () {
    const lines = [];
    const summary = await fixLabelSets(db(), { match, print: (line) => lines.push(line) });
    assert.deepEqual(summary, { projects: 2, layers: 7, fixed: 5, errors: 0 });
    const out = lines.join('\n');
    assert.include(out, `${PREFIX}stubs: layer "A": "Set I" → would set "10regions.json"`);
    assert.include(out, `${PREFIX}stubs: layer "E": null → would set "10regions.json"`);
    assert.include(out, '5 layers to set to 10regions.json in 1 projects (dry run, nothing written)');
    assert.deepEqual(await valuesOf(`${PREFIX}stubs`), ['Set I', 'set1.json', '', null, '<missing>', '']);
  });

  it('the command line dry run writes nothing', async function () {
    const { code, stdout } = await runScript(['--db', testDb]);
    assert.equal(code, 0, stdout);
    assert.include(stdout, `${PREFIX}stubs: layer "B": "set1.json" → would set "10regions.json"`);
    assert.deepEqual(await valuesOf(`${PREFIX}stubs`), ['Set I', 'set1.json', '', null, '<missing>', '']);
  }).timeout(U.mediumTimeout);

  it('apply sets the unknown vectorial label sets to 10 regions, only those; a second apply changes nothing', async function () {
    const before = await projects().findOne({ shortname: `${PREFIX}stubs`, backup: { $exists: false } });
    const first = await fixLabelSets(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(first, { fixed: 5, errors: 0 });
    assert.deepEqual(await valuesOf(`${PREFIX}stubs`), ['10regions.json', '10regions.json', '10regions.json', '10regions.json', '10regions.json', ''], 'the text layer is not changed');
    assert.deepEqual(await valuesOf(`${PREFIX}known`), ['10regions.json', '20 regions'], 'known files and names are kept');
    assert.deepEqual(await valuesOf(`${PREFIX}stubs`, true), ['Set I'], 'backups are not changed');
    const after = await projects().findOne({ shortname: `${PREFIX}stubs`, backup: { $exists: false } });
    assert.equal(String(after._id), String(before._id), 'in place: same version');
    assert.equal(await projects().countDocuments({ shortname: `${PREFIX}stubs` }), 2, 'no new version');

    const second = await fixLabelSets(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(second, { fixed: 0, errors: 0 });
  });
});
