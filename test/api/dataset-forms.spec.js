/* eslint-disable max-statements, max-lines-per-function -- one test per class, with its stub answers */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { execFile } = require('child_process');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const { classifySource, readSources } = require('../../scripts/check-dataset-forms');

// S1d (decisions D42): which datasets the viewer now refuses.
// scripts/check-dataset-forms.js classifies each source with page-helpers.js'
// own readers, on local stub servers here; scripts/list-dataset-sources.mongosh.js
// lists the sources the current projects name.
describe('Datasets D42 refuses (S1d)', function () {
  const script = path.join(__dirname, '../../scripts/check-dataset-forms.js');
  const SECRET = 'what the dataset holds: never printed';
  const DZI = '<?xml version="1.0"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" ' +
    'Format="jpg" Overlap="0" TileSize="512"><Size Width="480" Height="360"/></Image>';
  // eslint-disable-next-line no-template-curly-in-string -- a getTileUrl string, as datasets hold it
  const ACCEPTED = 'function (l, x, y) { return `https://tiles.example.org/${l}/${x}_${y}.jpg`; }';
  const REFUSED = 'function (l, x, y) { return "https://tiles.example.org/" + (l * 2) + "/" + x; }';
  const json = (data) => (res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  const text = (body) => (res) => res.end(body);
  const asked = [];
  const ANSWERS = {
    '/plain.json': json({ tileSources: ['a.dzi', { type: 'ome-zarr', url: 'a.zarr' }], secret: SECRET }),
    '/a.dzi': text(DZI),
    '/accepted.json': json({ tileSources: [{ getTileUrl: ACCEPTED }, { getTileUrl: ACCEPTED }, 'b.dzi'] }),
    '/refused.json': json({ tileSources: [{ getTileUrl: ACCEPTED }, { getTileUrl: REFUSED }] }),
    '/tilecodey.json': json({ tileCodeY: [{ getTileUrl: REFUSED }] }),
    '/ok.jsonp': text(`/* a comment */ f(${JSON.stringify({ tileSources: ['a.dzi'], secret: SECRET })});`),
    '/bad.jsonp': text(`f({tileSources: ['a.dzi'], secret: '${SECRET}'})`),
    '/entries.json': json({ tileSources: ['ok.jsonp', 'ok.jsonp', '/bad.jsonp', 'missing.jsonp'] }),
    '/script.json': json({ tileSources: ['https://tiles.example.org/info.js', 'a.dzi'] }),
    '/redirect': (res) => res.writeHead(302, { Location: '/accepted.json' }).end(),
    '/loop': (res) => res.writeHead(302, { Location: '/loop' }).end(),
    '/page': text(`<html><body>${SECRET}</body></html>`),
    '/slow': () => { /* never answers */ }
  };
  let server;
  let base;
  const options = { delay: 0, timeout: 2000 };
  const at = (p) => `${base}${p}`;
  const classOf = async (p, opts = options) => (await classifySource(at(p), opts)).kind;

  before(function (done) {
    server = http.createServer((req, res) => {
      asked.push(req.url);
      const answer = ANSWERS[req.url.split('?')[0]];
      if (answer) { answer(res); } else { res.writeHead(404).end(SECRET); }
    });
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after(function (done) {
    server.closeAllConnections();
    server.close(done);
  });

  beforeEach(function () { asked.length = 0; });

  it('a list or a DeepZoom image with no code is plain', async function () {
    assert.equal(await classOf('/plain.json'), 'plain');
    assert.equal(await classOf('/a.dzi'), 'plain');
  });

  it('getTileUrl strings that tileUrlFunction reads are accepted, with their count', async function () {
    const result = await classifySource(at('/accepted.json'), options);
    assert.equal(result.kind, 'accepted getTileUrl');
    assert.deepEqual(result.entries, { 'accepted getTileUrl': 2 });
  });

  it('one getTileUrl string tileUrlFunction refuses makes the source refused, also under tileCodeY', async function () {
    const result = await classifySource(at('/refused.json'), options);
    assert.equal(result.kind, 'refused getTileUrl');
    assert.deepEqual(result.entries, { 'accepted getTileUrl': 1, 'refused getTileUrl': 1 });
    assert.equal(await classOf('/tilecodey.json'), 'refused getTileUrl');
  });

  it('a .jsonp source is asked with callback=f, and parsed: f(JSON) is accepted, anything else refused', async function () {
    assert.equal(await classOf('/ok.jsonp'), 'accepted jsonp');
    assert.include(asked, '/ok.jsonp?callback=f');
    assert.equal(await classOf('/bad.jsonp'), 'refused jsonp');
  });

  it('a list\'s .jsonp entries are fetched and parsed, relative to the list', async function () {
    const result = await classifySource(at('/entries.json'), options);
    assert.equal(result.kind, 'refused jsonp');
    assert.deepEqual(result.entries, { 'accepted jsonp': 2, 'refused jsonp': 1, 'not reachable': 1 });
    assert.includeMembers(asked, ['/ok.jsonp?callback=f', '/bad.jsonp?callback=f', '/missing.jsonp?callback=f']);
  });

  it('a .js entry, which OpenSeadragon loads as a script, is flagged and not fetched', async function () {
    assert.equal(await classOf('/script.json'), '.js entry');
    assert.deepEqual(asked, ['/script.json']);
  });

  it('follows up to 5 redirects', async function () {
    assert.equal(await classOf('/redirect'), 'accepted getTileUrl');
    const loop = await classifySource(at('/loop'), options);
    assert.deepEqual([loop.kind, loop.reason], ['not reachable', 'more than 5 redirects']);
    assert.lengthOf(asked.filter((u) => u === '/loop'), 1 + 5);
  });

  it('an answer that is neither JSON nor DeepZoom is not a dataset', async function () {
    const result = await classifySource(at('/page'), options);
    assert.equal(result.kind, 'not a dataset');
    assert.notInclude(JSON.stringify(result), SECRET);
  });

  it('an error status, a time-out, a non-http address are not reachable; OME-Zarr and CZI are not fetched', async function () {
    assert.deepEqual(await classifySource(at('/missing.json'), options), { source: at('/missing.json'), kind: 'not reachable', entries: {}, reason: 'answered 404' });
    assert.equal((await classifySource(at('/slow'), { delay: 0, timeout: 200 })).reason, 'time-out');
    assert.equal((await classifySource('IMG_0001.jpg', options)).reason, 'not an http(s) address');
    assert.equal(await classOf('/store.zarr'), 'plain');
    assert.equal(await classOf('/slide.czi'), 'plain');
    assert.notInclude(asked, '/store.zarr');
    assert.notInclude(asked, '/slide.czi');
  });

  it('reads a list: first field of each line, no blanks, comments or duplicates', function () {
    assert.deepEqual(readSources('# sources\nhttps://a.example/x.json\t3\n\n  https://b.example/y.jsonp\r\nhttps://a.example/x.json\t1\n'),
      ['https://a.example/x.json', 'https://b.example/y.jsonp']);
  });

  it('reads a source list from a file: one line per source, then the count per class, never a dataset\'s content', async function () {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dataset-forms-'));
    const file = path.join(dir, 'sources.txt');
    await fs.promises.writeFile(file, ['/plain.json\t2', '/accepted.json', '/refused.json', '/ok.jsonp', '/bad.jsonp', '/page', '/missing.json'].map(at)
      .join('\n'));
    const { code, stdout } = await new Promise((resolve) => {
      execFile(process.execPath, [script, '--delay', '0', file], (err, out) => resolve({ code: err ? err.code : 0, stdout: out }));
    });
    await fs.promises.rm(dir, { recursive: true });
    assert.equal(code, 0);
    const lines = stdout.trim().split('\n');
    assert.deepEqual(lines.slice(0, 7).map((l) => l.split('\t')[1].replace(/ \(.*$/, '')), ['plain', 'accepted getTileUrl', 'refused getTileUrl', 'accepted jsonp', 'refused jsonp', 'not a dataset', 'not reachable']);
    assert.equal(lines[0], `${at('/plain.json')}\tplain`);
    assert.include(stdout, '1\trefused getTileUrl\n1\trefused jsonp\n1\tnot a dataset\n1\tnot reachable\n1\taccepted getTileUrl\n1\taccepted jsonp\n1\tplain\n7\tsources');
    assert.notInclude(stdout, SECRET);
    assert.notInclude(stdout, 'tiles.example.org');
  }).timeout(U.mediumTimeout);

  it('--help gives its usage; no file is an error', async function () {
    const run = (args) => new Promise((resolve) => {
      execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    });
    const help = await run(['--help']);
    assert.equal(help.code, 0);
    assert.include(help.stdout, 'Usage: node scripts/check-dataset-forms.js');
    const none = await run([]);
    assert.equal(none.code, 2);
    assert.include(none.stderr, 'Usage:');
  }).timeout(U.mediumTimeout);

  describe('scripts/list-dataset-sources.mongosh.js', function () {
    const PREFIX = 's1dsources';
    const SRC = 'https://s1d-sources-test.localhost/';
    const mongoshFile = path.join(__dirname, '../../scripts/list-dataset-sources.mongosh.js');
    let mongoshScript;
    const projects = () => U.getNativeDB().collection('projects');
    const project = (shortname, owner, files, extra = {}) => ({
      name: shortname, shortname, owner, collaborators: { list: [] }, files, annotations: { list: [] }, ...extra
    });

    // mongosh runs the file with its own `db` and `print`; here the same file
    // runs with stand-ins, and its aggregation on the test database
    const runWith = (rows) => {
      const said = { lines: [], collection: null, pipeline: null };
      vm.runInNewContext(mongoshScript, {
        print: (line) => said.lines.push(line),
        db: {
          getCollection: (name) => ({
            aggregate: (pipeline) => {
              Object.assign(said, { collection: name, pipeline });

              return { forEach: (fn) => rows.forEach(fn) };
            }
          })
        }
      });

      return said;
    };

    before(async function () {
      mongoshScript = await fs.promises.readFile(mongoshFile, 'utf8');
      await projects().deleteMany({ shortname: { $regex: `^${PREFIX}` } });
      await projects().insertMany([
        project(`${PREFIX}a`, 'alice', { list: [{ source: `${SRC}one.json`, name: 'One' }, `${SRC}two.jsonp`, { source: `${SRC}one.json`, name: 'again' }, { source: '', name: 'empty' }, null, { name: 'no source' }] }),
        project(`${PREFIX}b`, 'bob', { list: [{ source: `${SRC}one.json`, name: 'One' }, { source: `${SRC}three.json` }] }),
        project(`${PREFIX}c`, 'carol', null),
        project(`${PREFIX}d`, 'dave', { list: 'not a list' }),
        project(`${PREFIX}b`, 'bob', { list: [{ source: `${SRC}backup-only.json` }] }, { backup: true })
      ]);
    });

    after(async function () {
      await projects().deleteMany({ shortname: { $regex: `^${PREFIX}` } });
    });

    it('prints each source the current projects list, once, with the number of projects listing it, and nothing else', async function () {
      const { collection, pipeline } = runWith([]);
      assert.equal(collection, 'projects');
      const rows = await projects().aggregate(pipeline)
        .toArray();
      const { lines } = runWith(rows);
      const ours = lines.filter((l) => l.startsWith(SRC));
      assert.deepEqual(ours, [`${SRC}one.json\t2`, `${SRC}three.json\t1`, `${SRC}two.jsonp\t1`]);
      assert.notMatch(lines.join('\n'), /alice|bob|carol|dave|s1dsources|One|no source/);
    });
  });
});
