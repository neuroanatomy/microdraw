'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const { listLabelSets } = require('../../app/controller/api/labelsets');

// T002 3.2: microdraw's label sets are the files of app/public/labels/,
// listed by GET /api/getLabelsets as BrainBox lists its own.
describe('Label sets (T002 3.2)', function () {
  it('GET /api/getLabelsets lists 10regions.json with its name, logged out', async function () {
    const res = await chai.request(U.serverURL).get('/api/getLabelsets');
    assert.equal(res.status, 200);
    assert.isArray(res.body);
    assert.deepInclude(res.body, { name: '10 regions', source: '10regions.json' });
    res.body.forEach((set) => assert.hasAllKeys(set, ['name', 'source']));
  }).timeout(U.shortTimeout);

  it('lists 10 regions first, then 20 regions (T002 3.5)', async function () {
    const res = await chai.request(U.serverURL).get('/api/getLabelsets');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.slice(0, 2), [
      { name: '10 regions', source: '10regions.json' },
      { name: '20 regions', source: '20regions.json' }
    ]);
  }).timeout(U.shortTimeout);

  it('/labels/20regions.json: 20 labels, the first 10 as 10 regions, every colour distinct', async function () {
    const [ten, twenty] = await Promise.all(['10regions.json', '20regions.json']
      .map((f) => chai.request(U.serverURL).get(`/labels/${f}`)));
    assert.equal(twenty.status, 200);
    assert.equal(twenty.body.name, '20 regions');
    assert.lengthOf(twenty.body.labels, 20);
    assert.deepEqual(twenty.body.labels.slice(0, 10), ten.body.labels);
    twenty.body.labels.forEach((l, i) => assert.deepInclude(l, { name: `Region ${i + 1}`, value: i + 1, url: '' }));
    assert.lengthOf(new Set(twenty.body.labels.map((l) => l.color.join(','))), 20);
  }).timeout(U.shortTimeout);

  it('/labels/10regions.json is served, and the old /js/10regions.json answers 302 to it', async function () {
    const file = await chai.request(U.serverURL).get('/labels/10regions.json');
    assert.equal(file.status, 200);
    assert.equal(file.body.name, '10 regions');
    assert.lengthOf(file.body.labels, 10);
    const old = await chai.request(U.serverURL).get('/js/10regions.json')
      .redirects(0);
    assert.equal(old.status, 302);
    assert.equal(old.headers.location, '/labels/10regions.json');
  }).timeout(U.shortTimeout);

  describe('listLabelSets', function () {
    let dir;
    before(async function () {
      dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'md-labels-'));
      const write = (name, text) => fs.promises.writeFile(path.join(dir, name), text);
      await Promise.all([
        write('b.json', JSON.stringify({ name: 'Set B', labels: [] })),
        write('10regions.json', JSON.stringify({ name: '10 regions', labels: [] })),
        write('000.json', JSON.stringify({ name: 'Set 000', labels: [] })),
        write('a.json', JSON.stringify({ name: 'Set A', labels: [] })),
        write('bad.json', '{ not json'),
        write('noname.json', JSON.stringify({ labels: [] })),
        write('null.json', 'null'),
        write('notes.txt', JSON.stringify({ name: 'not a .json file' })),
        fs.promises.mkdir(path.join(dir, 'folder.json'))
      ]);
    });
    after(async function () {
      await fs.promises.rm(dir, { recursive: true, force: true });
    });

    it('lists the valid *.json files, 10regions.json first then by file name, skipping the others', async function () {
      assert.deepEqual(await listLabelSets(dir), [
        { name: '10 regions', source: '10regions.json' },
        { name: 'Set 000', source: '000.json' },
        { name: 'Set A', source: 'a.json' },
        { name: 'Set B', source: 'b.json' }
      ]);
    });
  });
});
