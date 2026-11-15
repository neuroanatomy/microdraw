'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { ObjectId } = require('neuroweblab');
const U = require('../mocha.test.util');
const { ensureIndexes, ANNOTATIONS_USER_INDEX } = require('../../app/controller/indexes');
const { userAnnotationsPipeline } = require('../../app/controller/user/userTabs');

/*
  T002 3.4: the user page's Datasets and Annotations tabs, as BrainBox's
  getUserFilesSlice and getUserAtlasSlice.
  - GET /user/json/:u/files: the datasets (`datasets`, T002 3.3) the user
    owns, newest `included` first, listed only if one of the user's current
    projects lists it and gives the visitor files view.
  - GET /user/json/:u/atlas: one row per (dataset, project) in which the user
    has current annotations, listed only if the visitor may view that
    project's files and annotations, newest first.
  Both filter, then page (start, length; 0 and 100 by default, length at most
  100), and answer 404 for an unknown user.
*/
const PREFIX = 'apitabs34';
const HOST = 'https://tabs34-test.localhost/data';
const owner = `${PREFIX}-owner`;
const other = `${PREFIX}-other`;
const many = `${PREFIX}-many`;
const nobody = `${PREFIX}-nobody`;
const member = { username: `${PREFIX}-member`, password: `${PREFIX}-member-password` };

const dsURL = (name) => `${HOST}/${name}.json`;
const [A, B, C, D, E, R, S, X] = ['a', 'b', 'c', 'd', 'e', 'r', 'sss', 'x'].map(dsURL);

const access = (files, annotations) => ({ collaborators: 'none', files, annotations });
const project = (shortname, anyone, memberAccess, files) => {
  const p = U.createProjectWithPermission(shortname, {});
  p.owner = owner;
  p.collaborators.list = [{ username: 'anyone', access: anyone, name: 'Any User' }];
  if (memberAccess) {
    // a collaborator row with userID only (T002 2.2)
    p.collaborators.list.push({ userID: member.username, access: memberAccess });
  }
  p.files.list = files;

  return p;
};
const pub = project(`${PREFIX}pub`, access('view', 'view'), null,
  [{ source: A, name: 'a in pub' }, { source: B, name: '' }, { source: R, name: 'Row name' }, { source: X, name: 'x' }]);
const priv = project(`${PREFIX}priv`, access('none', 'none'), access('view', 'view'), [{ source: C, name: 'c' }, A]);
const privFilesOnly = project(`${PREFIX}privfiles`, access('none', 'none'), access('view', 'none'), [{ source: D, name: 'd' }]);

// The Annotations rows of pub, newest first
const PUBLIC_ROWS = ['b', 'sss', 'r', 'a'].map((name) => `${pub.shortname}/${name}.json`);

const day = (n) => new Date(Date.UTC(2026, 0, n, 12)).toJSON();
const datasets = [
  { source: A, name: 'Alpha', owner, included: day(1) },
  { source: B, name: 'Beta', owner, included: day(3) },
  { source: C, name: 'Gamma', owner, included: day(2) },
  { source: D, name: 'Delta', owner, included: day(4) },
  // in no project
  { source: E, name: 'Epsilon', owner, included: day(5) },
  // someone else's
  { source: X, name: 'Other', owner: other, included: day(6) }
];

// An ObjectId of day `n` of February 2026, unique by a counter
let counter = 0;
const idOf = (n) => {
  counter += 1;
  const seconds = Math.floor(Date.UTC(2026, 1, n, 12) / 1000);

  return new ObjectId(seconds.toString(16).padStart(8, '0') + counter.toString(16).padStart(16, '0'));
};
const modified = (n) => new Date(Date.UTC(2026, 1, n, 12)).toJSON();
const annotation = (user, projectName, source, slice, n, extra = {}) => ({
  _id: idOf(n), fileID: `${source}&slice=${slice}`, user, project: projectName, Hash: 'h', annotation: { path: [] }, ...extra
});
const annotations = [
  // pub/A: slices 0, 1 (two regions), 2; slice 3 only as backups, newer
  annotation(owner, pub.shortname, A, 0, 8),
  annotation(owner, pub.shortname, A, 1, 9),
  annotation(owner, pub.shortname, A, 1, 10),
  annotation(owner, pub.shortname, A, 2, 7),
  annotation(owner, pub.shortname, A, 3, 50, { backup: true }),
  annotation(owner, pub.shortname, A, 0, 51, { backup: true }),
  annotation(owner, pub.shortname, R, 0, 12),
  annotation(owner, pub.shortname, S, 4, 14),
  annotation(owner, pub.shortname, B, 0, 20),
  annotation(owner, priv.shortname, A, 5, 30),
  annotation(owner, privFilesOnly.shortname, D, 0, 40),
  // no project (before H3b), a deleted project
  annotation(owner, '', A, 0, 45),
  annotation(owner, `${PREFIX}gone`, A, 0, 46),
  // someone else's, in pub
  annotation(other, pub.shortname, A, 9, 60)
];

const get = (pathname) => chai.request(U.serverURL).get(pathname);
const urls = (res) => res.body.list.map((row) => row.url);
const rowsOf = (res) => res.body.list.map((row) => `${row.project}/${row.url.slice(HOST.length + 1)}`);

const removeAll = async () => {
  const db = U.getNativeDB();
  await db.collection('projects').deleteMany({ shortname: { $regex: `^${PREFIX}` } });
  await db.collection('datasets').deleteMany({ source: { $regex: '^https://tabs34-test\\.localhost/' } });
  await db.collection('annotations').deleteMany({ user: { $in: [owner, other, many] } });
  await db.collection('users').deleteMany({ username: { $in: [owner, other, many, nobody, member.username] } });
};

describe('User page Datasets and Annotations tabs (T002 3.4)', function () {
  let agent;

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await removeAll();
    for (const username of [owner, other, many, nobody]) {
      // eslint-disable-next-line no-await-in-loop
      await U.insertUser({ username, name: username, joined: new Date() });
    }
    await U.insertProject([pub, priv, privFilesOnly]);
    await U.getNativeDB().collection('datasets')
      .insertMany(datasets.map((d) => ({ ...d })));
    await U.insertAnnotations(annotations);
    agent = await U.logIn(member);
  });

  after(async function () {
    // agent.close() would close the shared server: only the data goes
    await removeAll();
  });

  describe('Datasets: GET /user/json/:userName/files', function () {
    it('lists the owner\'s datasets newest first, those a logged-out visitor may see', async function () {
      const res = await get(`/user/json/${owner}/files`);
      assert.equal(res.status, 200);
      assert.isTrue(res.body.success);
      assert.deepEqual(res.body.list, [
        { url: B, name: 'Beta', included: day(3), projects: [pub.shortname] },
        { url: A, name: 'Alpha', included: day(1), projects: [pub.shortname] }
      ]);
    }).timeout(U.shortTimeout);

    it('shows a collaborator with files view the datasets of private projects', async function () {
      const res = await agent.get(`/user/json/${owner}/files`);
      assert.equal(res.status, 200);
      assert.deepEqual(urls(res), [D, B, C, A]);
      const alpha = res.body.list.find((row) => row.url === A);
      assert.sameMembers(alpha.projects, [pub.shortname, priv.shortname]);
      assert.deepEqual(res.body.list[0].projects, [privFilesOnly.shortname]);
    }).timeout(U.shortTimeout);

    it('never lists a dataset in none of the user\'s projects, nor someone else\'s', async function () {
      const res = await agent.get(`/user/json/${owner}/files`);
      assert.notInclude(urls(res), E);
      assert.notInclude(urls(res), X);
    }).timeout(U.shortTimeout);

    it('pages after filtering', async function () {
      assert.deepEqual(urls(await agent.get(`/user/json/${owner}/files?start=1&length=2`)), [B, C]);
      assert.deepEqual(urls(await get(`/user/json/${owner}/files?start=1&length=1`)), [A]);
      assert.deepEqual(urls(await get(`/user/json/${owner}/files?start=2`)), []);
    }).timeout(U.shortTimeout);

    it('answers an empty list for a user with no datasets', async function () {
      const res = await get(`/user/json/${nobody}/files`);
      assert.equal(res.status, 200);
      assert.isTrue(res.body.success);
      assert.deepEqual(res.body.list, []);
    }).timeout(U.shortTimeout);

    it('answers 404 for an unknown user', async function () {
      const res = await get(`/user/json/${PREFIX}-unknown/files`);
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('Annotations: GET /user/json/:userName/atlas', function () {
    it('groups the current annotations by dataset and project, newest first', async function () {
      const res = await agent.get(`/user/json/${owner}/atlas`);
      assert.equal(res.status, 200);
      assert.isTrue(res.body.successful);
      assert.deepEqual(rowsOf(res), [`${priv.shortname}/a.json`, ...PUBLIC_ROWS]);
    }).timeout(U.shortTimeout);

    it('counts distinct slices, ignores backups, dates rows by their newest current annotation', async function () {
      const res = await get(`/user/json/${owner}/atlas`);
      const row = res.body.list.find((r) => r.url === A && r.project === pub.shortname);
      assert.deepEqual(row, { url: A, name: 'Alpha', project: pub.shortname, slices: 3, modified: modified(10) });
    }).timeout(U.shortTimeout);

    it('names a row by its dataset, else its project row, else its URL', async function () {
      const res = await get(`/user/json/${owner}/atlas`);
      const nameOf = (source) => res.body.list.find((r) => r.url === source).name;
      assert.equal(nameOf(B), 'Beta');
      assert.equal(nameOf(R), 'Row name');
      assert.equal(nameOf(S), 'sss');
    }).timeout(U.shortTimeout);

    it('hides the rows of projects the visitor may not view the annotations of', async function () {
      const loggedOut = rowsOf(await get(`/user/json/${owner}/atlas`));
      assert.deepEqual(loggedOut, PUBLIC_ROWS);
      const asMember = rowsOf(await agent.get(`/user/json/${owner}/atlas`));
      assert.notInclude(asMember, `${privFilesOnly.shortname}/d.json`, 'files view only');
      assert.notInclude(asMember.join(' '), `${PREFIX}gone`, 'a deleted project');
      assert.notInclude(asMember, '/a.json', 'no project');
    }).timeout(U.shortTimeout);

    it('pages after filtering', async function () {
      assert.deepEqual(rowsOf(await agent.get(`/user/json/${owner}/atlas?start=1&length=2`)),
        [`${pub.shortname}/b.json`, `${pub.shortname}/sss.json`]);
      assert.deepEqual(rowsOf(await get(`/user/json/${owner}/atlas?start=3&length=5`)), [`${pub.shortname}/a.json`]);
    }).timeout(U.shortTimeout);

    it('answers an empty list for a user without annotations, 404 for an unknown user', async function () {
      const res = await get(`/user/json/${nobody}/atlas`);
      assert.equal(res.status, 200);
      assert.isTrue(res.body.successful);
      assert.deepEqual(res.body.list, []);
      assert.equal((await get(`/user/json/${PREFIX}-unknown/atlas`)).status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('Annotations index and a user with thousands of annotated slices', function () {
    const SOURCES = 150;
    const SLICES = 20;
    const manyProject = project(`${PREFIX}many`, access('view', 'view'), null, []);
    manyProject.owner = many;

    before(async function () {
      // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
      this.timeout(U.mediumTimeout);
      await U.insertProject(manyProject);
      const docs = [];
      for (let s = 0; s < SOURCES; s++) {
        for (let k = 0; k < SLICES; k++) {
          docs.push(annotation(many, manyProject.shortname, dsURL(`many${s}`), k, 1 + (s % 27)));
        }
      }
      await U.insertAnnotations(docs);
    });

    it('exists after startup, and is created again without error', async function () {
      const indexes = async () => (await U.getNativeDB().collection('annotations')
        .indexInformation())[ANNOTATIONS_USER_INDEX];
      assert.deepEqual(await indexes(), [['user', 1], ['project', 1]]);
      await ensureIndexes(U.getNativeDB());
      assert.deepEqual(await indexes(), [['user', 1], ['project', 1]]);
    }).timeout(U.shortTimeout);

    it('is used by the aggregation (IXSCAN, not COLLSCAN)', async function () {
      const explain = await U.getNativeDB().collection('annotations')
        .aggregate(userAnnotationsPipeline(many))
        .explain();
      const plan = JSON.stringify(explain);
      assert.include(plan, 'IXSCAN');
      assert.include(plan, ANNOTATIONS_USER_INDEX);
      assert.notInclude(plan, 'COLLSCAN');
    }).timeout(U.shortTimeout);

    it(`answers ${SOURCES * SLICES} annotated slices in under a second, 100 rows at most`, async function () {
      const t0 = Date.now();
      const res = await get(`/user/json/${many}/atlas?length=500`);
      const elapsed = Date.now() - t0;
      assert.equal(res.status, 200);
      assert.lengthOf(res.body.list, 100);
      assert.isTrue(res.body.list.every((row) => row.slices === SLICES));
      assert.isBelow(elapsed, 1000);
      const rest = await get(`/user/json/${many}/atlas?start=100`);
      assert.lengthOf(rest.body.list, SOURCES - 100);
    }).timeout(U.shortTimeout);
  });

  // The tabs are rendered in the browser from the page's inline template.
  it('the user page template has the Projects, Datasets and Annotations tabs', async function () {
    const res = await get(`/user/${owner}`);
    assert.equal(res.status, 200);
    const tabs = [...res.text.matchAll(/<Tab title="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ['Projects', 'Datasets', 'Annotations']);
  }).timeout(U.shortTimeout);
});
