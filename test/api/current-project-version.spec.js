'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const { ensureIndexes, PROJECTS_SHORTNAME_INDEX } = require('../../app/controller/indexes');

// T002 2.1a: every read of a project by shortname reads only the current
// version (no `backup` field), the newest `_id` first if there are several.
// Old versions (`backup: true`) keep the project's shortname; 2.1b will write
// them on each save. Each test inserts an older backup first (other name,
// files, collaborators and permissions), then the current version: before
// 2.1a, the reads took the first document in natural order, the backup.
// eslint-disable-next-line max-statements
describe('Project reads use the current version only (T002 2.1a)', function () {
  const PREFIX = 'currentversion';
  const user = { username: 'current-version-user', password: 'current-version-user-password' };
  const source = (tag) => `/test_data/${PREFIX}-${tag}.json`;
  let agent;

  // A project document; `anyone` and `member` are the access of 'anyone' and
  // of `user` ({collaborators, annotations, files}), member null for none.
  const version = (shortname, { name, tag, anyone, member = null, backup = false }) => {
    const list = [{ username: 'anyone', name: 'Any User', access: anyone }];
    if (member) {
      list.push({ userID: user.username, username: user.username, name: user.username, access: member });
    }
    const doc = {
      name,
      shortname,
      url: '',
      created: '2026-11-09T00:00:00.000Z',
      owner: 'current-version-owner',
      collaborators: { list },
      files: { list: [{ source: source(tag), name: `${tag} file` }] },
      annotations: { list: [{ type: 'vectorial', name: `${tag} layer`, values: 'Set 1', display: true }] }
    };
    if (backup) {
      doc.backup = true;
    }

    return doc;
  };
  const access = (files, annotations) => ({ collaborators: 'view', annotations, files });

  // older first: its _id is smaller, and it comes first in natural order
  const insertVersions = async (...docs) => {
    for (const doc of docs) {
      // eslint-disable-next-line no-await-in-loop
      await U.insertProject(doc);
    }
  };

  const region = (name) => ({
    annotation: { name, path: ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }] }
  });
  const upload = (shortname, tag) => agent.post('/api/upload')
    .query({ action: 'append', source: source(tag), slice: 0, project: shortname })
    .attach('data', Buffer.from(JSON.stringify([region('r')])), 'annotation.json');

  const removeAll = async () => {
    const ours = { $regex: `^${PREFIX}` };
    await U.getDB().collection('projects')
      .deleteMany({ shortname: ours });
    await U.getDB().collection('annotations')
      .deleteMany({ project: ours });
  };

  before(async function () {
    await removeAll();
    agent = await U.logIn(user);
  });

  after(async function () {
    await removeAll();
    await U.removeLocalUser(user.username);
  });

  describe('GET /project/:projectName (project page)', function () {
    it('shows the current name and files, not the backup\'s', async function () {
      const shortname = `${PREFIX}page`;
      await insertVersions(
        version(shortname, { name: 'Old page name', tag: 'old', anyone: access('view', 'view'), backup: true }),
        version(shortname, { name: 'Current page name', tag: 'new', anyone: access('view', 'view') })
      );
      const res = await chai.request(U.serverURL).get(`/project/${shortname}`);
      assert.equal(res.status, 200);
      assert.include(res.text, 'Current page name');
      assert.include(res.text, source('new'));
      assert.notInclude(res.text, 'Old page name');
      assert.notInclude(res.text, source('old'));
    }).timeout(U.shortTimeout);

    // 401 to a logged-out visitor since 2026-11-11 (shared suite 1.5; was 403)
    it('follows the current permissions: 401 when only the backup was public', async function () {
      const shortname = `${PREFIX}pageprivate`;
      await insertVersions(
        version(shortname, { name: 'Old public', tag: 'old', anyone: access('view', 'view'), backup: true }),
        version(shortname, { name: 'Now private', tag: 'new', anyone: access('none', 'none') })
      );
      const res = await chai.request(U.serverURL).get(`/project/${shortname}`);
      assert.equal(res.status, 401);
    }).timeout(U.shortTimeout);

    it('answers 404 when the project has only backups', async function () {
      const shortname = `${PREFIX}pagegone`;
      await insertVersions(version(shortname, { name: 'Only a backup', tag: 'old', anyone: access('view', 'view'), backup: true }));
      const res = await chai.request(U.serverURL).get(`/project/${shortname}`);
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('GET /project/:projectName/settings', function () {
    it('shows the current name, files and collaborators, not the backup\'s', async function () {
      const shortname = `${PREFIX}settings`;
      await insertVersions(
        version(shortname, { name: 'Old settings name', tag: 'old', anyone: access('view', 'view'), member: access('edit', 'edit'), backup: true }),
        version(shortname, { name: 'Current settings name', tag: 'new', anyone: access('view', 'view') })
      );
      const res = await chai.request(U.serverURL).get(`/project/${shortname}/settings`);
      assert.equal(res.status, 200);
      assert.include(res.text, 'Current settings name');
      assert.include(res.text, source('new'));
      assert.notInclude(res.text, 'Old settings name');
      assert.notInclude(res.text, source('old'));
      assert.notInclude(res.text, user.username);
    }).timeout(U.shortTimeout);

    // 401 to a logged-out visitor since 2026-11-11 (shared suite 1.5; was 403)
    it('follows the current permissions: 401 when only the backup was public', async function () {
      const shortname = `${PREFIX}settingsprivate`;
      await insertVersions(
        version(shortname, { name: 'Old public', tag: 'old', anyone: access('view', 'view'), backup: true }),
        version(shortname, { name: 'Now private', tag: 'new', anyone: access('none', 'none') })
      );
      const res = await chai.request(U.serverURL).get(`/project/${shortname}/settings`);
      assert.equal(res.status, 401);
    }).timeout(U.shortTimeout);
  });

  describe('GET /api (annotations of a project)', function () {
    it('refuses when only the backup let anyone view the annotations', async function () {
      const shortname = `${PREFIX}apiview`;
      await insertVersions(
        version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'view'), backup: true }),
        version(shortname, { name: 'New', tag: 'new', anyone: access('view', 'none') })
      );
      const res = await chai.request(U.serverURL).get('/api')
        .query({ project: shortname, source: source('new'), slice: 0 });
      assert.equal(res.status, 403);
    }).timeout(U.shortTimeout);

    it('answers when the current version lets anyone view the annotations', async function () {
      const shortname = `${PREFIX}apiviewnow`;
      await insertVersions(
        version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'none'), backup: true }),
        version(shortname, { name: 'New', tag: 'new', anyone: access('view', 'view') })
      );
      const res = await chai.request(U.serverURL).get('/api')
        .query({ project: shortname, source: source('new'), slice: 0 });
      assert.equal(res.status, 200);
    }).timeout(U.shortTimeout);
  });

  describe('GET /api/permissions', function () {
    it('answers from the current collaborators and files', async function () {
      const shortname = `${PREFIX}permissions`;
      await insertVersions(
        version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'none'), member: access('edit', 'edit'), backup: true }),
        version(shortname, { name: 'New', tag: 'new', anyone: access('view', 'view'), member: access('view', 'view') })
      );
      const asUser = await agent.get('/api/permissions').query({ project: shortname, source: source('new') });
      assert.equal(asUser.status, 200);
      assert.deepEqual(asUser.body.annotations, { view: true, edit: false });
      assert.deepEqual(asUser.body.image, { source: source('new'), listed: true });
      const oldImage = await agent.get('/api/permissions').query({ project: shortname, source: source('old') });
      assert.deepEqual(oldImage.body.image, { source: source('old'), listed: false });
      const anyone = await chai.request(U.serverURL).get('/api/permissions')
        .query({ project: shortname });
      assert.deepEqual(anyone.body.annotations, { view: true, edit: false });
    }).timeout(U.shortTimeout);
  });

  describe('annotationEditRefusal (POST /api, /api/upload)', function () {
    it('refuses a save the backup allowed but the current version does not', async function () {
      const shortname = `${PREFIX}editrefused`;
      await insertVersions(
        version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'view'), member: access('view', 'edit'), backup: true }),
        version(shortname, { name: 'New', tag: 'new', anyone: access('view', 'view'), member: access('view', 'view') })
      );
      const uploaded = await upload(shortname, 'new');
      assert.equal(uploaded.status, 403);
      const saved = await agent.post('/api').send({
        action: 'save', project: shortname, source: source('new'), slice: 0, Hash: 'x', annotation: '[]'
      });
      assert.equal(saved.status, 403);
      assert.equal(await U.getDB().collection('annotations')
        .countDocuments({ project: shortname }), 0);
    }).timeout(U.shortTimeout);

    it('allows a save the current version allows but the backup did not', async function () {
      const shortname = `${PREFIX}editallowed`;
      await insertVersions(
        version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'view'), member: access('view', 'view'), backup: true }),
        version(shortname, { name: 'New', tag: 'new', anyone: access('view', 'view'), member: access('view', 'edit') })
      );
      const uploaded = await upload(shortname, 'new');
      assert.equal(uploaded.status, 200);
      assert.equal(await U.getDB().collection('annotations')
        .countDocuments({ project: shortname }), 1);
    }).timeout(U.shortTimeout);

    it('answers 404 when the project has only backups', async function () {
      const shortname = `${PREFIX}editgone`;
      await insertVersions(version(shortname, { name: 'Old', tag: 'old', anyone: access('view', 'edit'), member: access('view', 'edit'), backup: true }));
      const uploaded = await upload(shortname, 'old');
      assert.equal(uploaded.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('two current documents for one shortname', function () {
    // eslint-disable-next-line max-statements
    it('the newest _id wins on every read', async function () {
      const shortname = `${PREFIX}twocurrent`;
      await insertVersions(
        version(shortname, { name: 'Older current', tag: 'old', anyone: access('view', 'edit') }),
        version(shortname, { name: 'Newer current', tag: 'new', anyone: access('view', 'view') })
      );
      const page = await chai.request(U.serverURL).get(`/project/${shortname}`);
      assert.include(page.text, 'Newer current');
      assert.notInclude(page.text, 'Older current');
      const settings = await chai.request(U.serverURL).get(`/project/${shortname}/settings`);
      assert.include(settings.text, 'Newer current');
      assert.notInclude(settings.text, 'Older current');
      const json = await chai.request(U.serverURL).get(`/project/json/${shortname}`);
      assert.equal(json.body.name, 'Newer current');
      const permissions = await chai.request(U.serverURL).get('/api/permissions')
        .query({ project: shortname });
      assert.deepEqual(permissions.body.annotations, { view: true, edit: false });
      const uploaded = await upload(shortname, 'new');
      assert.equal(uploaded.status, 403);
    }).timeout(U.shortTimeout);
  });

  describe('index on projects {shortname: 1}', function () {
    const indexes = () => U.getNativeDB().collection('projects')
      .indexes();
    const ours = async () => (await indexes()).find((i) => i.name === PROJECTS_SHORTNAME_INDEX);

    it('exists after startup, not unique', async function () {
      const index = await ours();
      assert.isOk(index);
      assert.deepEqual(index.key, { shortname: 1 });
      assert.notOk(index.unique);
    }).timeout(U.shortTimeout);

    it('is created again without error when it exists already', async function () {
      await ensureIndexes(U.getNativeDB());
      assert.deepEqual((await ours()).key, { shortname: 1 });
    }).timeout(U.shortTimeout);

    it('lets several documents share a shortname (versions)', async function () {
      const shortname = `${PREFIX}index`;
      await insertVersions(
        version(shortname, { name: 'A', tag: 'old', anyone: access('view', 'view'), backup: true }),
        version(shortname, { name: 'B', tag: 'new', anyone: access('view', 'view') })
      );
      assert.equal(await U.getDB().collection('projects')
        .countDocuments({ shortname }), 2);
    }).timeout(U.shortTimeout);

    // With the _id sort of findCurrentProject, the planner may prefer the _id
    // index on a collection as small as the test one; checked without the sort.
    it('serves lookups by shortname (IXSCAN, not COLLSCAN)', async function () {
      const explain = await U.getNativeDB().collection('projects')
        .find({ shortname: `${PREFIX}index`, backup: { $exists: false } })
        .explain();
      const plan = JSON.stringify(explain.queryPlanner.winningPlan);
      assert.include(plan, PROJECTS_SHORTNAME_INDEX);
      assert.notInclude(plan, 'COLLSCAN');
    }).timeout(U.shortTimeout);
  });
});
