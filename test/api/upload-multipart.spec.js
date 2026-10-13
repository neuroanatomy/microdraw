'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const U = require('../mocha.test.util');

// M5c (multer 1 → 2): how POST /api/upload handles the multipart body itself,
// with memory storage (the default) and with TMP_DIR (disk storage, read once
// when the api module loads, so it runs in a second app process). Recorded on
// multer 1.4.5-lts.2 (2026-10-13).
// eslint-disable-next-line max-statements -- one fixture shared by both storages
describe('POST /api/upload multipart handling (M5c)', function () {
  const credentials = { username: 'm5c-upload-user', password: 'm5c-upload-password' };
  const source = 'm5c-upload-source';
  const project = U.createPublicAnnotationProject('m5cuploadmultipart');
  const region = (name) => ({
    annotation: { name, path: ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }] }
  });
  const query = (token) => ({ action: 'save', source, slice: 0, project: project.shortname, token });
  let token;

  const savedNames = async () => (await U.findAnnotations({ fileID: `${source}&slice=0` }))
    .map((a) => a.annotation.name);

  const assertStillServing = async () => {
    const res = await chai.request(U.serverURL).get('/api')
      .query({ action: 'load_last', source, slice: 0, project: project.shortname });
    assert.equal(res.status, 200);
  };

  // A raw request, for bodies chai-http can't send (broken multipart). Options
  // object only: nock 10, loaded by other specs, doesn't take (url, options, cb).
  const rawPost = (contentType, body) => new Promise((resolve, reject) => {
    const { hostname, port } = new URL(U.serverURL);
    const req = http.request({
      hostname,
      port,
      path: `/api/upload?${new URLSearchParams(query(token))}`,
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });

  before(async function () {
    await U.insertProject(project);
    const agent = await U.logIn(credentials);
    ({ token } = (await agent.get('/token')).body);
    assert.isNotEmpty(token);
  });

  afterEach(async function () {
    await U.removeAnnotations(source);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeProject(project.shortname);
    await U.removeLocalUser(credentials.username);
  });

  it('refuses a file sent under another field name (500), saves nothing', async function () {
    const res = await chai.request(U.serverURL).post('/api/upload')
      .query(query(token))
      .attach('other', Buffer.from(JSON.stringify([region('wrong field')])), 'annotation.json');
    assert.equal(res.status, 500);
    assert.isEmpty(await savedNames());
    await assertStillServing();
  }).timeout(U.shortTimeout);

  it('uses the first of several files', async function () {
    const res = await chai.request(U.serverURL).post('/api/upload')
      .query(query(token))
      .attach('data', Buffer.from(JSON.stringify([region('first')])), 'first.json')
      .attach('data', Buffer.from(JSON.stringify([region('second')])), 'second.json');
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(await savedNames(), ['first']);
  }).timeout(U.shortTimeout);

  it('answers a multipart body without a boundary with 500 and keeps serving', async function () {
    assert.equal(await rawPost('multipart/form-data', 'no boundary'), 500);
    await assertStillServing();
  }).timeout(U.shortTimeout);

  it('answers a truncated multipart body with 500 and keeps serving', async function () {
    const body = '--XyZ\r\nContent-Disposition: form-data; name="data"; filename="a.json"\r\n'
      + 'Content-Type: application/json\r\n\r\n[{"annotation"';
    assert.equal(await rawPost('multipart/form-data; boundary=XyZ', body), 500);
    assert.isEmpty(await savedNames());
    await assertStillServing();
  }).timeout(U.shortTimeout);

  describe('with TMP_DIR (disk storage)', function () {
    let child, port, tmpDir;

    before(async function () {
      // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
      this.timeout(U.longTimeout);
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'microdraw-m5c-'));
      child = spawn(process.execPath, [
        '-e',
        "require('./app/app').start().then(({ port }) => console.log('M5C_PORT ' + port))"
      ], {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, TMP_DIR: tmpDir, PORT: '0', WS_PORT: '0', CFG_PATH: './cfg.json.example' },
        stdio: ['ignore', 'pipe', 'inherit']
      });
      port = await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += chunk;
          const match = out.match(/M5C_PORT (\d+)/);
          if (match) {
            resolve(match[1]);
          }
        });
        child.once('exit', (code) => reject(new Error(`app with TMP_DIR exited (${code})`)));
      });
    });

    after(async function () {
      if (child) {
        child.kill();
      }
      if (tmpDir) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('saves the upload, read from the file written in TMP_DIR', async function () {
      const res = await chai.request(`http://127.0.0.1:${port}`).post('/api/upload')
        .query(query(token))
        .attach('data', Buffer.from(JSON.stringify([region('from disk')])), 'annotation.json');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await savedNames(), ['from disk']);
      const files = await fs.promises.readdir(tmpDir);
      assert.lengthOf(files, 1, 'multer wrote the upload to TMP_DIR');
      const written = JSON.parse(await fs.promises.readFile(path.join(tmpDir, files[0]), 'utf8'));
      assert.equal(written[0].annotation.name, 'from disk');
    }).timeout(U.mediumTimeout);
  });
});
