'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const monk = require('monk');
const U = require('../mocha.test.util');

// The "Last modified" date of a project (user page): the later of its last
// save (POST /project/json/:projectName sets `modified` and `modifiedBy`, as
// BrainBox does) and its newest annotation (the time in the annotation's _id).
const owner = { username: 'api-modified-owner', password: 'api-modified-owner-password' };
const editor = { username: 'api-modified-editor', password: 'api-modified-editor-password' };
const PREFIX = 'apimodified';

// An ObjectId made at `iso` (seconds), as the one of an annotation saved then
const idAt = (iso) => monk.id(Math.floor(Date.parse(iso) / 1000).toString(16)
  .padStart(8, '0') + '0000000000000000');

const annotationAt = (project, iso, extra = {}) => ({
  _id: idAt(iso),
  fileID: '/test_data/cat.json&slice=0',
  user: owner.username,
  project,
  Hash: 'x',
  annotation: { uid: `${project}-${iso}`, name: 'r' },
  ...extra
});

const stored = (shortname, { modified, anyone = 'view', ownerName = owner.username } = {}) => {
  const p = U.createProjectWithPermission(shortname, { files: 'view' });
  p.owner = ownerName;
  p.collaborators.list[0].access.files = anyone;
  if (modified) {
    p.modified = modified;
  }

  return p;
};

const newProject = (shortname, extra = {}) => ({
  name: 'Modified project',
  shortname,
  url: '',
  description: '',
  created: '2026-10-12T00:00:00.000Z',
  collaborators: {
    list: [
      { username: 'anyone', name: 'Any User', access: { collaborators: 'view', annotations: 'none', files: 'view' } },
      { username: editor.username, name: editor.username, access: { collaborators: 'view', annotations: 'edit', files: 'edit' } }
    ]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set 1', display: true }] },
  ...extra
});

const listing = (agent = chai.request(U.serverURL)) => agent.get(`/user/json/${owner.username}/projects`);
const byName = (res, shortname) => res.body.list.find((p) => p.shortname === shortname);

const removeAll = async () => {
  const ours = { $regex: `^${PREFIX}` };
  await U.getDB().get('projects')
    .remove({ shortname: ours });
  await U.getDB().get('annotations')
    .remove({ project: ours });
};

describe('Last modified of a project (save date, newest annotation)', function () {
  let editorAgent, ownerAgent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await removeAll();
    ownerAgent = await U.logIn(owner);
    editorAgent = await U.logIn(editor);
  });

  after(async function () {
    await removeAll();
  });

  describe('a save sets modified and modifiedBy', function () {
    const name = `${PREFIX}save`;

    it('on a new project: now, by its creator; a date sent by the client is ignored', async function () {
      const before = Date.now();
      const res = await ownerAgent.post(`/project/json/${name}`)
        .send({ data: newProject(name, { modified: '2000-01-01T00:00:00.000Z', modifiedBy: 'someone-else' }) });
      assert.equal(res.status, 200, res.text);
      const doc = await U.queryProject(name);
      assert.isString(doc.modified);
      assert.equal(new Date(doc.modified).toJSON(), doc.modified, 'an ISO string');
      assert.isAtLeast(Date.parse(doc.modified), before - 1000);
      assert.isAtMost(Date.parse(doc.modified), Date.now() + 1000);
      assert.equal(doc.modifiedBy, owner.username);
    }).timeout(U.shortTimeout);

    it('on an update: a later date, by the collaborator who saved', async function () {
      const first = (await U.queryProject(name)).modified;
      await U.delay(5);
      const res = await editorAgent.post(`/project/json/${name}`)
        .send({ data: newProject(name, { name: 'Renamed' }) });
      assert.equal(res.status, 200, res.text);
      const doc = await U.queryProject(name);
      assert.isAbove(Date.parse(doc.modified), Date.parse(first));
      assert.equal(doc.modifiedBy, editor.username);
    }).timeout(U.shortTimeout);

    it('not on a refused save', async function () {
      const { modified } = await U.queryProject(name);
      const res = await editorAgent.post(`/project/json/${name}`)
        .send({ data: newProject(name, { files: 'not a list' }) });
      assert.equal(res.status, 400, res.text);
      assert.equal((await U.queryProject(name)).modified, modified);
    }).timeout(U.shortTimeout);
  });

  describe('the user\'s projects list', function () {
    before(async function () {
      await U.insertProject([
        stored(`${PREFIX}annotlater`, { modified: '2026-01-01T10:00:00.000Z' }),
        { ...stored(`${PREFIX}savelater`, { modified: '2026-09-01T10:00:00.000Z' }), modifiedBy: 'api-modified-hidden' },
        stored(`${PREFIX}annotonly`),
        stored(`${PREFIX}neither`),
        stored(`${PREFIX}private`, { anyone: 'none' })
      ]);
      await U.insertAnnotations([
        annotationAt(`${PREFIX}annotlater`, '2026-03-01T00:00:00.000Z'),
        annotationAt(`${PREFIX}annotlater`, '2026-05-02T03:04:05.000Z', { backup: true }),
        annotationAt(`${PREFIX}annotlater`, '2026-04-01T00:00:00.000Z'),
        annotationAt(`${PREFIX}savelater`, '2026-02-01T00:00:00.000Z'),
        annotationAt(`${PREFIX}annotonly`, '2025-12-24T18:00:00.000Z'),
        annotationAt(`${PREFIX}private`, '2026-10-01T12:34:56.000Z')
      ]);
    });

    it('gives the newest annotation when it is later than the last save', async function () {
      const res = await listing();
      assert.equal(res.status, 200);
      assert.equal(byName(res, `${PREFIX}annotlater`).modified, '2026-05-02T03:04:05.000Z');
    }).timeout(U.shortTimeout);

    it('gives the last save when it is later than the newest annotation', async function () {
      const res = await listing();
      assert.equal(byName(res, `${PREFIX}savelater`).modified, '2026-09-01T10:00:00.000Z');
    }).timeout(U.shortTimeout);

    it('gives the newest annotation of a project never saved since the change', async function () {
      const res = await listing();
      assert.equal(byName(res, `${PREFIX}annotonly`).modified, '2025-12-24T18:00:00.000Z');
    }).timeout(U.shortTimeout);

    it('gives no modified to a project with neither', async function () {
      const res = await listing();
      assert.notProperty(byName(res, `${PREFIX}neither`), 'modified');
    }).timeout(U.shortTimeout);

    it('keeps the access filtering: a hidden project and its annotation dates are not sent', async function () {
      const anonymous = await listing();
      assert.isUndefined(byName(anonymous, `${PREFIX}private`));
      assert.notInclude(anonymous.text, '2026-10-01T12:34:56');
      const asOwner = await listing(ownerAgent);
      assert.equal(byName(asOwner, `${PREFIX}private`).modified, '2026-10-01T12:34:56.000Z');
    }).timeout(U.shortTimeout);

    it('shows who saved last only to visitors who may see the collaborators', async function () {
      const anonymous = await listing();
      assert.notProperty(byName(anonymous, `${PREFIX}savelater`), 'modifiedBy');
      assert.notInclude(anonymous.text, 'api-modified-hidden');
      const asOwner = await listing(ownerAgent);
      assert.equal(byName(asOwner, `${PREFIX}savelater`).modifiedBy, 'api-modified-hidden');
    }).timeout(U.shortTimeout);

    it('pages as before, each page with its own dates', async function () {
      const all = (await listing()).body.list.map((p) => [p.shortname, p.modified]);
      const pages = [];
      for (let start = 0; start < all.length; start += 2) {
        // eslint-disable-next-line no-await-in-loop -- one page after the other
        const res = await chai.request(U.serverURL).get(`/user/json/${owner.username}/projects?start=${start}&length=2`);
        pages.push(...res.body.list.map((p) => [p.shortname, p.modified]));
      }
      assert.deepEqual(pages, all);
    }).timeout(U.shortTimeout);
  });
});
