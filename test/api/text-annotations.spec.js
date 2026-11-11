/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { ObjectId } = require('neuroweblab');
const U = require('../mocha.test.util');
const { ensureIndexes, TEXT_ANNOTATIONS_INDEX } = require('../../app/controller/indexes');
const { findDeleteEntry, restoreDeletedProject } = require('../../app/controller/project/project.delete');

// Text layers step 2 (2026-11-09): values of named text layers, one per
// (project, source, layer), in `textAnnotations`, with history.
// GET /project/json/:projectName/text-annotations, POST /api/text-annotation.
const owner = { username: 'tl2-owner', password: 'tl2-owner-password' };
const editor = { username: 'tl2-editor', password: 'tl2-editor-password' };
const viewer = { username: 'tl2-viewer', password: 'tl2-viewer-password' };
const stranger = { username: 'tl2-stranger', password: 'tl2-stranger-password' };

const srcA = 'tl2-a.dzi';
const srcB = 'tl2-b.dzi';

const collaborator = (user, annotations) => ({
  userID: user.username,
  username: user.username,
  name: user.username,
  access: { collaborators: 'none', annotations, files: 'view' }
});

// anyone: { files, annotations } access of 'anyone'
const project = (shortname, anyone = { files: 'view', annotations: 'view' }) => ({
  name: `TL2 ${shortname}`,
  shortname,
  url: '',
  created: '2026-11-09T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      { username: 'anyone', name: 'Any User', access: { collaborators: 'none', ...anyone } },
      collaborator(editor, 'edit'),
      collaborator(viewer, 'view')
    ]
  },
  files: { list: [{ source: srcA, name: 'a' }, { source: srcB, name: 'b' }] },
  annotations: {
    list: [
      { type: 'text', name: 'Notes', values: '', display: true },
      { type: 'text', name: 'Progress', values: '', display: true },
      { type: 'vectorial', name: 'Regions', values: 'Set 1', display: true },
      { type: 'text', name: '', values: '', display: true },
      { type: 'text', name: '  ', values: '', display: true }
    ]
  }
});

const shortnames = ['tl2read', 'tl2hidden', 'tl2private', 'tl2write', 'tl2other', 'tl2anyview', 'tl2delete'];

const textDocs = (query) => U.getDB().collection('textAnnotations')
  .find(query, { sort: { _id: 1 } })
  .toArray();

const doc = (shortname, source, layer, value, extra = {}) => ({
  project: shortname,
  source,
  layer,
  value,
  user: owner.username,
  modified: new Date('2026-11-09T10:00:00Z'),
  ...extra
});

// eslint-disable-next-line max-statements
describe('Values of text layers (text layers step 2)', function () {
  const agents = {};
  const tokens = {};

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await Promise.all([owner, editor, viewer, stranger].map(async (user) => {
      agents[user.username] = await U.logIn(user);
      tokens[user.username] = (await agents[user.username].get('/token')).body.token;
    }));
    await U.insertProject([
      project('tl2read'),
      project('tl2hidden', { files: 'view', annotations: 'none' }),
      project('tl2private', { files: 'none', annotations: 'none' }),
      project('tl2write'),
      project('tl2other'),
      project('tl2anyview', { files: 'view', annotations: 'view' }),
      project('tl2delete')
    ]);
  });

  after(async function () {
    await Promise.all([
      ...shortnames.map((s) => U.removeProject(s)),
      U.getDB().collection('textAnnotations')
        .deleteMany({ project: { $in: shortnames } }),
      U.getDB().collection('log')
        .deleteMany({ 'value.shortname': { $in: shortnames } }),
      ...[owner, editor, viewer, stranger].map((u) => U.removeLocalUser(u.username))
    ]);
  });

  const read = (shortname, agent) => (agent || chai.request(U.serverURL)).get(`/project/json/${shortname}/text-annotations`);
  const write = (user, body) => agents[user.username].post('/api/text-annotation')
    .send(body);

  describe('index', function () {
    const indexNamed = async (name) => (await U.getDB().collection('textAnnotations')
      .indexInformation())[name];
    const keys = [['project', 1], ['source', 1], ['layer', 1], ['_id', -1]];

    it('exists after startup', async function () {
      assert.deepEqual(await indexNamed(TEXT_ANNOTATIONS_INDEX), keys);
    }).timeout(U.shortTimeout);

    it('is created again without error when it exists already', async function () {
      await ensureIndexes(U.getDB());
      assert.deepEqual(await indexNamed(TEXT_ANNOTATIONS_INDEX), keys);
    }).timeout(U.shortTimeout);

    it('does not throw when an index on the same keys has another name', async function () {
      const collection = U.getDB().collection('textAnnotations');
      await collection.dropIndex(TEXT_ANNOTATIONS_INDEX);
      await collection.createIndex({ project: 1, source: 1, layer: 1, _id: -1 }, { name: 'other-name' });
      try {
        await ensureIndexes(U.getDB());
      } finally {
        await collection.dropIndex('other-name');
        await ensureIndexes(U.getDB());
      }
      assert.deepEqual(await indexNamed(TEXT_ANNOTATIONS_INDEX), keys);
    }).timeout(U.shortTimeout);

    it('is used by the read (IXSCAN, not COLLSCAN)', async function () {
      const explain = await U.getDB().collection('textAnnotations')
        .find({ project: 'tl2read', source: { $in: [srcA, srcB] }, layer: { $in: ['Notes'] }, backup: { $exists: false } }, { sort: { _id: -1 } })
        .explain();
      const plan = JSON.stringify(explain);
      assert.include(plan, 'IXSCAN');
      assert.include(plan, TEXT_ANNOTATIONS_INDEX);
      assert.notInclude(plan, 'COLLSCAN');
    }).timeout(U.shortTimeout);
  });

  // eslint-disable-next-line max-statements
  describe('GET /project/json/:projectName/text-annotations', function () {
    before(async function () {
      const older = new ObjectId('6730000000000000000000a1');
      const newer = new ObjectId('6730000000000000000000a2');
      await U.getDB().collection('textAnnotations')
        .insertMany([
          doc('tl2read', srcA, 'Notes', 'note a'),
          doc('tl2read', srcB, 'Progress', 'old progress', { _id: older }),
          doc('tl2read', srcB, 'Progress', 'new progress', { _id: newer, user: editor.username }),
          doc('tl2read', srcB, 'Notes', 'backup only', { backup: true }),
          doc('tl2read', srcA, 'Progress', 'current'),
          doc('tl2read', srcA, 'Progress', 'newer backup', { backup: true }),
          doc('tl2read', srcA, 'Regions', 'vectorial'),
          doc('tl2read', srcA, '', 'unnamed'),
          doc('tl2read', srcA, '  ', 'blank name'),
          doc('tl2read', srcA, 'Removed', 'removed layer'),
          doc('tl2read', 'tl2-gone.dzi', 'Notes', 'removed source'),
          doc('tl2hidden', srcA, 'Notes', 'hidden note')
        ]);
    });

    it('answers the current values of named text layers only, the newest current one per key', async function () {
      const res = await read('tl2read');
      assert.equal(res.status, 200, res.text);
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.deepEqual(res.body, {
        [srcA]: {
          Notes: { value: 'note a', user: owner.username, modified: '2026-11-09T10:00:00.000Z' },
          Progress: { value: 'current', user: owner.username, modified: '2026-11-09T10:00:00.000Z' }
        },
        [srcB]: {
          Progress: { value: 'new progress', user: editor.username, modified: '2026-11-09T10:00:00.000Z' }
        }
      });
    }).timeout(U.shortTimeout);

    it('does not answer a value of a layer or source removed from the project', async function () {
      const res = await read('tl2read');
      assert.notProperty(res.body[srcA], 'Removed');
      assert.notProperty(res.body, 'tl2-gone.dzi');
    }).timeout(U.shortTimeout);

    it('does not answer backups, even newer than the current value', async function () {
      const res = await read('tl2read');
      assert.notProperty(res.body[srcB], 'Notes');
      assert.equal(res.body[srcA].Progress.value, 'current');
    }).timeout(U.shortTimeout);

    it('answers {} to a visitor who may not see the annotation layers (M3c), the values to one who may', async function () {
      let res = await read('tl2hidden');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {});
      res = await read('tl2hidden', agents[stranger.username]);
      assert.deepEqual(res.body, {});
      res = await read('tl2hidden', agents[owner.username]);
      assert.equal(res.body[srcA].Notes.value, 'hidden note');
      res = await chai.request(U.serverURL).get('/project/json/tl2hidden/text-annotations')
        .query({ token: tokens[owner.username] });
      assert.equal(res.body[srcA].Notes.value, 'hidden note');
      // the same layers as the project page shows each visitor
      await Promise.all([null, stranger, viewer, owner].map(async (user) => {
        const query = user ? { token: tokens[user.username] } : {};
        const page = await chai.request(U.serverURL).get('/project/json/tl2hidden')
          .query(query);
        const values = await chai.request(U.serverURL).get('/project/json/tl2hidden/text-annotations')
          .query(query);
        assert.equal(page.body.annotations.list.length > 0, Object.keys(values.body).length > 0, user ? user.username : 'anyone');
      }));
    }).timeout(U.shortTimeout);

    it('answers an unknown or hidden project as GET /project/json/:projectName', async function () {
      await Promise.all(['tl2nosuchproject', 'tl2private'].map(async (shortname) => {
        const answer = await chai.request(U.serverURL).get(`/project/json/${shortname}`);
        const res = await read(shortname);
        assert.equal(res.status, answer.status, shortname);
        assert.deepEqual(res.body, answer.body, shortname);
      }));
      assert.equal((await read('tl2nosuchproject')).status, 404);
      // logged out: 401 since 2026-11-11, as the JSON route (shared suite 1.5; was 403)
      assert.equal((await read('tl2private')).status, 401);
      assert.equal((await read('tl2private', agents[viewer.username])).status, 200);
    }).timeout(U.shortTimeout);
  });

  // eslint-disable-next-line max-statements
  describe('POST /api/text-annotation', function () {
    const body = (extra = {}) => ({ project: 'tl2write', source: srcA, layer: 'Notes', value: 'hello', ...extra });

    it('answers 401 when logged out', async function () {
      const res = await chai.request(U.serverURL).post('/api/text-annotation')
        .send(body());
      assert.equal(res.status, 401);
      assert.lengthOf(await textDocs({ project: 'tl2write' }), 0);
    }).timeout(U.shortTimeout);

    it('answers 404 for an unknown project, 400 for a missing or non-string project', async function () {
      let res = await write(editor, body({ project: 'tl2nosuchproject' }));
      assert.equal(res.status, 404);
      res = await write(editor, body({ project: { $gt: '' } }));
      assert.equal(res.status, 400);
      res = await write(editor, { source: srcA, layer: 'Notes', value: 'hello' });
      assert.equal(res.status, 400);
    }).timeout(U.shortTimeout);

    it('answers 403 to a view-only collaborator and to a user with anyone\'s view access', async function () {
      let res = await write(viewer, body());
      assert.equal(res.status, 403);
      res = await write(stranger, body({ project: 'tl2anyview' }));
      assert.equal(res.status, 403);
      assert.lengthOf(await textDocs({ project: { $in: ['tl2write', 'tl2anyview'] } }), 0);
    }).timeout(U.shortTimeout);

    it('answers 400 for an unknown, vectorial or unnamed layer and an unknown source', async function () {
      const refused = [
        { layer: 'Unknown' },
        { layer: 'Regions' },
        { layer: '' },
        { layer: '  ' },
        { layer: ['Notes'] },
        { source: 'tl2-unknown.dzi' },
        { source: { $ne: '' } }
      ];
      await Promise.all(refused.map(async (extra) => {
        const res = await write(editor, body(extra));
        assert.equal(res.status, 400, JSON.stringify(extra));
        assert.isString(res.body.error);
      }));
      assert.match((await write(editor, body({ layer: 'Regions' }))).body.error, /not a named text layer/);
      assert.match((await write(editor, body({ source: 'x' }))).body.error, /not a file of project/);
      assert.lengthOf(await textDocs({ project: 'tl2write' }), 0);
    }).timeout(U.shortTimeout);

    it('answers 400 for a non-string value and for more than 10 000 characters', async function () {
      await Promise.all([12, null, true, { a: 1 }, ['a'], 'x'.repeat(10001)].map(async (value) => {
        const res = await write(editor, body({ value }));
        assert.equal(res.status, 400, String(value).slice(0, 20));
      }));
      // no value at all
      const res = await write(editor, { project: 'tl2write', source: srcA, layer: 'Notes' });
      assert.equal(res.status, 400);
      assert.lengthOf(await textDocs({ project: 'tl2write' }), 0);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('stores a value; a second write makes the first a backup', async function () {
      const max = 'y'.repeat(10000);
      let res = await write(editor, body({ value: 'first' }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(Object.keys(res.body), ['value', 'user', 'modified']);
      assert.equal(res.body.value, 'first');
      assert.equal(res.body.user, editor.username);
      assert.closeTo(Date.parse(res.body.modified), Date.now(), 60000);

      res = await write(owner, body({ value: max }));
      assert.equal(res.status, 200, res.text);
      const docs = await textDocs({ project: 'tl2write', source: srcA, layer: 'Notes' });
      assert.lengthOf(docs, 2);
      assert.equal(docs[0].value, 'first');
      assert.isTrue(docs[0].backup);
      assert.equal(docs[1].value, max);
      assert.equal(docs[1].user, owner.username);
      assert.notProperty(docs[1], 'backup');
      assert.instanceOf(docs[1].modified, Date);

      res = await read('tl2write');
      assert.equal(res.body[srcA].Notes.value, max);
    }).timeout(U.shortTimeout);

    it('stores \'\' as a value that clears, history kept', async function () {
      const res = await write(editor, body({ source: srcB, layer: 'Progress', value: 'to clear' }));
      assert.equal(res.status, 200);
      const cleared = await write(editor, body({ source: srcB, layer: 'Progress', value: '' }));
      assert.equal(cleared.status, 200);
      assert.equal(cleared.body.value, '');
      const docs = await textDocs({ project: 'tl2write', source: srcB, layer: 'Progress' });
      assert.deepEqual(docs.map((d) => [d.value, Boolean(d.backup)]), [['to clear', true], ['', false]]);
      assert.equal((await read('tl2write')).body[srcB].Progress.value, '');
    }).timeout(U.shortTimeout);

    it('leaves another project with the same source and layer name untouched', async function () {
      await U.getDB().collection('textAnnotations')
        .insertOne(doc('tl2other', srcA, 'Notes', 'other project'));
      const res = await write(editor, body({ value: 'in tl2write' }));
      assert.equal(res.status, 200);
      const other = await textDocs({ project: 'tl2other' });
      assert.lengthOf(other, 1);
      assert.notProperty(other[0], 'backup');
      assert.equal((await read('tl2other')).body[srcA].Notes.value, 'other project');
    }).timeout(U.shortTimeout);

    it('accepts an API token, as the /api saves', async function () {
      const res = await chai.request(U.serverURL).post('/api/text-annotation')
        .query({ token: tokens[editor.username] })
        .send(body({ source: srcB, layer: 'Notes', value: 'by token' }));
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.user, editor.username);
    }).timeout(U.shortTimeout);
  });

  describe('project delete and restore', function () {
    // eslint-disable-next-line max-statements
    it('a delete marks the project\'s current values as backups with the delete\'s log id', async function () {
      await U.getDB().collection('textAnnotations')
        .insertMany([
          doc('tl2delete', srcA, 'Notes', 'older', { backup: true }),
          doc('tl2delete', srcA, 'Notes', 'current'),
          doc('tl2delete', srcB, 'Progress', 'current b')
        ]);
      const res = await agents[owner.username].delete('/project/json/tl2delete');
      assert.equal(res.status, 200, res.text);
      const docs = await textDocs({ project: 'tl2delete' });
      assert.isTrue(docs.every((d) => d.backup));
      assert.deepEqual(docs.filter((d) => d.deletedWithProject === res.body.log).map((d) => d.value), ['current', 'current b']);
      assert.notProperty(docs[0], 'deletedWithProject');
      assert.lengthOf(await textDocs({ project: 'tl2other', backup: true }), 0);

      // a new project with that shortname starts without values
      await U.insertProject(project('tl2delete'));
      assert.deepEqual((await read('tl2delete')).body, {});
      await U.removeProject('tl2delete');
    }).timeout(U.shortTimeout);

    it('a restore makes current again exactly the values that delete marked', async function () {
      const entry = await U.getDB().collection('log')
        .findOne({ key: 'deleteProject', 'value.shortname': 'tl2delete' });
      const restored = await restoreDeletedProject(U.getDB(), { entry: await findDeleteEntry(U.getDB(), String(entry._id)), username: 'tl2-admin' });
      assert.notProperty(restored, 'status');
      const docs = await textDocs({ project: 'tl2delete' });
      assert.deepEqual(docs.map((d) => [d.value, Boolean(d.backup)]), [['older', true], ['current', false], ['current b', false]]);
      assert.isTrue(docs.every((d) => !('deletedWithProject' in d)));
      const res = await read('tl2delete');
      assert.equal(res.body[srcA].Notes.value, 'current');
      assert.equal(res.body[srcB].Progress.value, 'current b');
    }).timeout(U.shortTimeout);
  });
});
