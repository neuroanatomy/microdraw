/* eslint-disable max-statements -- one test per behaviour, with its checks */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const _ = require('lodash');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const { backfillDatasets } = require('../../scripts/backfill-datasets');

// T002 3.3: scripts/backfill-datasets.js gives every http(s) dataset listed
// in a current project its `datasets` document, from the oldest project
// listing it (owner, row name, created). Dry run by default; a second apply
// creates nothing; backups, empty and non-http(s) sources are ignored.
describe('Backfill of the dataset documents (T002 3.3)', function () {
  const PREFIX = 'backfill33';
  const match = new RegExp(`^${PREFIX}`);
  const BASE = 'https://backfill33-test.localhost/';
  const url = (name) => `${BASE}${name}.json`;
  const script = path.join(__dirname, '../../scripts/backfill-datasets.js');
  const testDb = process.env.MONGODB_TEST || '127.0.0.1:27017/circleci_test';

  const db = () => U.getNativeDB();
  const projects = () => db().collection('projects');
  const datasets = () => db().collection('datasets');
  const ours = () => datasets().find({ source: { $regex: '^https://backfill33-test\\.localhost/' } }, { projection: { _id: 0 }, sort: { source: 1 } })
    .toArray();
  const runScript = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

  const project = (shortname, owner, files, extra = {}) => ({
    name: shortname,
    shortname,
    url: '',
    owner,
    collaborators: { list: [{ username: 'anyone', userID: 'anyone', access: { collaborators: 'view', annotations: 'view', files: 'view' } }] },
    files: { list: files },
    annotations: { list: [] },
    ...extra
  });
  const fixtures = () => [
    // the oldest by created: owns shared and its name wins
    project(`${PREFIX}old`, 'alice', [
      { source: url('shared'), name: 'Shared (old)' },
      { source: url('onlyold'), name: '' },
      { source: '', name: 'empty' },
      { source: 'IMG_0001.jpg', name: '648' }
    ], { created: '2021-01-01T00:00:00.000Z' }),
    project(`${PREFIX}new`, 'bob', [
      { source: url('shared'), name: 'Shared (new)' },
      url('stringentry')
    ], { created: '2024-01-01T00:00:00.000Z' }),
    // no created: ordered by its first version (2025), included = now
    project(`${PREFIX}nocreated`, 'carol', [{ source: url('stringentry'), name: 'From carol' }], { modified: '2025-06-01T00:00:00.000Z' }),
    // a backup version, ignored, even though it is older and lists more
    project(`${PREFIX}old`, 'mallory', [{ source: url('backuponly'), name: 'Backup' }, { source: url('shared'), name: 'Backup name' }], { created: '2020-01-01T00:00:00.000Z', backup: true })
  ];

  const reset = async () => {
    await projects().deleteMany({ shortname: { $regex: match } });
    await datasets().deleteMany({ source: { $regex: '^https://backfill33-test\\.localhost/' } });
    await projects().insertMany(fixtures());
  };

  beforeEach(async function () {
    await reset();
  });

  after(async function () {
    await projects().deleteMany({ shortname: { $regex: match } });
    await datasets().deleteMany({ source: { $regex: '^https://backfill33-test\\.localhost/' } });
  });

  it('exits with its usage without --db', async function () {
    const { code, stderr } = await runScript([]);
    assert.equal(code, 2);
    assert.include(stderr, 'Usage: node scripts/backfill-datasets.js --db');
  }).timeout(U.mediumTimeout);

  it('dry run (the default) prints what it would create and writes nothing', async function () {
    const { code, stdout } = await runScript(['--db', testDb]);
    assert.equal(code, 0, stdout);
    assert.include(stdout, `would create: ${url('shared')} (name "Shared (old)", owner alice, included 2021-01-01T00:00:00.000Z, from ${PREFIX}old)`);
    assert.include(stdout, `skipped, not an http(s) URL: "IMG_0001.jpg" in ${PREFIX}old`);
    assert.match(stdout, /\d+ documents to create \(dry run, nothing written\)/);
    assert.deepEqual(await ours(), []);
  }).timeout(U.mediumTimeout);

  it('dry run summary counts rows, datasets, skipped rows and names that differ', async function () {
    const lines = [];
    const summary = await backfillDatasets(db(), { match, print: (line) => lines.push(line) });
    assert.deepEqual(summary, { projects: 3, rows: 7, distinct: 3, existing: 0, created: 3, skipped: 2, renamed: 2, errors: 0 });
    const out = lines.join('\n');
    assert.include(out, `skipped, not an http(s) URL: "" in ${PREFIX}old`);
    assert.include(out, '2 datasets have different names in different projects');
    assert.include(out, `${url('shared')}: "Shared (new)", "Shared (old)"`);
    assert.include(out, '3 projects, 7 file rows, 3 distinct datasets (0 with a document already), 3 documents to create (dry run, nothing written), 2 rows skipped (not http(s)), 2 datasets named differently across projects, 0 errors.');
    assert.deepEqual(await ours(), []);
  });

  it('apply creates one document per distinct source, from the oldest project; a second apply creates nothing', async function () {
    const first = await backfillDatasets(db(), { apply: true, match, print: _.noop });
    assert.equal(first.created, 3);
    const docs = await ours();
    assert.deepEqual(docs.map((d) => _.omit(d, ['included'])), [
      { source: url('onlyold'), name: 'onlyold', owner: 'alice' },
      { source: url('shared'), name: 'Shared (old)', owner: 'alice' },
      // the string entry in bob's 2024 project is older than carol's 2025 version
      { source: url('stringentry'), name: 'stringentry', owner: 'bob' }
    ]);
    assert.deepEqual(docs.map((d) => d.included), ['2021-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z']);
    assert.notInclude(docs.map((d) => d.source), url('backuponly'));

    const second = await backfillDatasets(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(second, { distinct: 3, existing: 3, created: 0 });
    assert.deepEqual(await ours(), docs);
  });

  it('a project without created is ordered by its first version, and its documents are included now', async function () {
    await projects().deleteMany({ shortname: `${PREFIX}new` });
    const before = Date.now();
    await backfillDatasets(db(), { apply: true, match, print: _.noop });
    const doc = await datasets().findOne({ source: url('stringentry') });
    assert.deepInclude(doc, { name: 'From carol', owner: 'carol' });
    assert.isAtLeast(Date.parse(doc.included), before - 1000);
  });

  it('apply leaves existing documents as they are', async function () {
    await datasets().insertOne({ source: url('shared'), name: 'Kept', owner: 'zed', included: '2019-01-01T00:00:00.000Z' });
    const summary = await backfillDatasets(db(), { apply: true, match, print: _.noop });
    assert.deepInclude(summary, { existing: 1, created: 2 });
    assert.deepInclude(await datasets().findOne({ source: url('shared') }, { projection: { _id: 0 } }), { name: 'Kept', owner: 'zed' });
    assert.lengthOf(await ours(), 3);
  });
});
