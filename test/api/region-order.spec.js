'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// T002 3.5: the editor save stores each region's paint order, `order`, on its
// current document. An order-only change is set in place (same _id, user, no
// backup); a changed region is stored anew with its order; regions not sent
// keep theirs; a region sent without `order` (older client) leaves it as is.
// eslint-disable-next-line max-statements
describe('Region order in the editor save (T002 3.5)', function () {
  const source = 'region-order-source';
  const slice = 0;
  const userA = { username: 'rorderusera', password: 'rorder-user-a-password' };
  const userB = { username: 'rorderuserb', password: 'rorder-user-b-password' };
  const project = U.createProjectWithPermission('rorderproject', { files: 'view', annotations: 'edit' });
  const editor = (username) => ({
    username,
    userID: username,
    name: username,
    access: { collaborators: 'none', annotations: 'edit', files: 'view' }
  });
  project.owner = userA.username;
  project.collaborators.list = [project.collaborators.list[0], editor(userA.username), editor(userB.username)];

  const region = (uid, x) => ({
    name: uid,
    uid,
    path: ['Path', { segments: [[x, 10], [x + 20, 30], [x + 40, 10]], closed: true }]
  });
  const ordered = (regions) => regions.map((r, order) => ({ ...r, order }));
  const [a1, a2, b1] = [region('a1', 0), region('a2', 100), region('b1', 200)];
  let agentA;
  let agentB;

  const save = async (agent, Regions, RegionsToRemove = []) => {
    const res = await agent.post('/api').send({
      action: 'save',
      source,
      slice,
      project: project.shortname,
      Hash: 'rorder',
      annotation: JSON.stringify({ Regions, RegionsToRemove })
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  const load = async (withBackups) => {
    const query = { source, slice, project: project.shortname };
    if (withBackups) {
      query.backup = '';
    }
    const res = await agentA.get('/api').query(query);
    assert.equal(res.status, 200);

    return res.body;
  };
  const byUid = async () => Object.fromEntries((await load()).map((d) => [d.annotation.uid, d]));

  before(async function () {
    agentA = await U.logIn(userA);
    agentB = await U.logIn(userB);
    await U.removeProject(project.shortname);
    await U.insertProject(project);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeProject(project.shortname);
    await U.removeLocalUser(userA.username);
    await U.removeLocalUser(userB.username);
  });

  beforeEach(async function () {
    await U.removeAnnotations(source);
  });

  it('stores each region with its order, beside the annotation', async function () {
    await save(agentA, ordered([a1, a2]));
    const docs = await byUid();
    assert.equal(docs.a1.order, 0);
    assert.equal(docs.a2.order, 1);
    assert.deepEqual(docs.a1.annotation, a1, 'the annotation has no order');
  }).timeout(U.shortTimeout);

  it('an order-only save sets the order in place: same _id and user, no backup', async function () {
    await save(agentA, ordered([a1, a2]));
    const before = await byUid();
    await save(agentB, ordered([a2, a1]));
    const after = await byUid();
    assert.deepEqual([after.a2.order, after.a1.order], [0, 1]);
    for (const uid of ['a1', 'a2']) {
      assert.equal(String(after[uid]._id), String(before[uid]._id), uid);
      assert.equal(after[uid].user, userA.username, uid);
    }
    assert.isEmpty((await load(true)).filter((d) => d.backup), 'no backup');
  }).timeout(U.shortTimeout);

  it('a path change after a reorder keeps the order', async function () {
    await save(agentA, ordered([a1, a2]));
    await save(agentA, ordered([a2, a1]));
    const moved = { ...a1, path: ['Path', { segments: [[0, 0], [50, 50], [0, 50]], closed: true }] };
    await save(agentA, ordered([a2, moved]));
    const docs = await byUid();
    assert.equal(docs.a1.order, 1);
    assert.deepEqual(docs.a1.annotation.path, moved.path);
    assert.lengthOf((await load(true)).filter((d) => d.backup), 1, 'the old a1');
  }).timeout(U.shortTimeout);

  it("A's reorder leaves B's regions it did not load as they are", async function () {
    await save(agentA, ordered([a1, a2]));
    // B loaded {a1, a2} and added b1 on top
    await save(agentB, ordered([a1, a2, b1]));
    const before = await byUid();
    // A still holds {a1, a2} and swaps them
    await save(agentA, ordered([a2, a1]));
    const after = await byUid();
    assert.deepEqual([after.a2.order, after.a1.order], [0, 1]);
    assert.deepEqual(after.b1, before.b1, "B's region: same document, order and user");
    assert.isEmpty((await load(true)).filter((d) => d.backup));
  }).timeout(U.shortTimeout);

  it('a save without order (older client) leaves the stored order', async function () {
    await save(agentA, ordered([a1, a2]));
    await save(agentA, [a2, a1]);
    const docs = await byUid();
    assert.deepEqual([docs.a1.order, docs.a2.order], [0, 1]);
  }).timeout(U.shortTimeout);

  // 2026-11-15: how a region is displayed (opacity, visible) is not saved and is no change
  it('a region sent without the opacity stored by an older save is unchanged', async function () {
    const hidden = { ...a1, path: ['Path', { ...a1.path[1], opacity: 0, visible: true }] };
    await save(agentA, ordered([hidden]));
    const before = await byUid();
    await save(agentB, ordered([a1]));
    const after = await byUid();
    assert.equal(String(after.a1._id), String(before.a1._id));
    assert.equal(after.a1.user, userA.username);
    assert.isEmpty((await load(true)).filter((d) => d.backup), 'no backup');
  }).timeout(U.shortTimeout);
});
