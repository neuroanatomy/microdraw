'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// Two users editing the same slice of the same project. The viewer saves every
// region it holds for the slice, other users' included, from the copy it
// loaded (tools/save.js, POST /api {action: 'save', ...}). A save must not
// erase regions another user saved in the meantime, and each region keeps the
// name of the user who drew it.
// eslint-disable-next-line max-statements
describe('Concurrent saves on the same slice', function () {
  const source = 'concurrent-save-source';
  const slice = 0;
  const userA = { username: 'csaveusera', password: 'csave-user-a-password' };
  const userB = { username: 'csaveuserb', password: 'csave-user-b-password' };
  const project = U.createProjectWithPermission('csaveproject', { files: 'view', annotations: 'edit' });
  const editor = (username) => ({
    username,
    userID: username,
    name: username,
    access: { collaborators: 'none', annotations: 'edit', files: 'view' }
  });
  project.owner = userA.username;
  project.collaborators.list = [project.collaborators.list[0], editor(userA.username), editor(userB.username)];

  const region = (name, x) => ({
    name,
    uid: `csave${name}`,
    path: ['Path', { segments: [[x, 10], [x + 20, 30], [x + 40, 10]], closed: true }]
  });
  const r1 = region('r1', 0);
  const a1 = region('a1', 100);
  const b1 = region('b1', 200);
  let agentA;
  let agentB;

  // What the viewer sends: the regions it holds for the slice.
  const save = async (agent, Regions, RegionsToRemove = []) => {
    const res = await agent.post('/api').send({
      action: 'save',
      source,
      slice,
      project: project.shortname,
      Hash: 'csave',
      annotation: JSON.stringify({ Regions, RegionsToRemove })
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };

  // What GET /api answers for the slice: current annotations, or all versions.
  const load = async (agent, withBackups) => {
    const query = { source, slice, project: project.shortname };
    if (withBackups) {
      query.backup = '';
    }
    const res = await agent.get('/api').query(query);
    assert.equal(res.status, 200);

    return res.body;
  };
  const names = (docs) => docs.map((d) => d.annotation.name).sort();

  // A saves r1, then {r1, a1}; B loads after that and saves {r1, a1, b1}.
  const freshCopySaves = async () => {
    await save(agentA, [r1]);
    await save(agentA, [r1, a1]);
    const loadedByB = (await load(agentB)).map((d) => d.annotation);
    await save(agentB, [...loadedByB, b1]);
  };

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

  // The stale-copy overwrite: B's save moved a1 to the backups before the editor save applied only its changes.
  it('keeps regions another user saved after the slice was loaded (stale copy)', async function () {
    await save(agentA, [r1]);
    // A and B both hold {r1}
    await save(agentA, [r1, a1]);
    await save(agentB, [r1, b1]);

    // Before the fix a1 was moved to the backups, and this test checked it was
    // at least kept there. Now B's save leaves a1 alone: no region is backed up.
    const backups = (await load(agentA, true)).filter((d) => d.backup);
    assert.deepEqual(names(backups), [], 'no region was replaced or removed');
    assert.deepEqual(names(await load(agentA)), ['a1', 'b1', 'r1'], 'current slice after both saves');
  }).timeout(U.shortTimeout);

  it('keeps every region when the second user saves from a fresh copy (control)', async function () {
    await freshCopySaves();
    assert.deepEqual(names(await load(agentA)), ['a1', 'b1', 'r1'], 'current slice after both saves');
  }).timeout(U.shortTimeout);

  // The authorship loss: every region was stored under the last saver's name before that change.
  it('stores each region under the user who drew it', async function () {
    await freshCopySaves();
    const authors = {};
    (await load(agentA)).forEach((d) => {
      authors[d.annotation.name] = d.user;
    });
    assert.deepEqual(authors, { r1: userA.username, a1: userA.username, b1: userB.username }, 'author of each region');
  }).timeout(U.shortTimeout);

  // The current document of each region, by name.
  const currentByName = async () => {
    const byName = {};
    (await load(agentA)).forEach((d) => {
      assert.notProperty(byName, d.annotation.name, `one current document for ${d.annotation.name}`);
      byName[d.annotation.name] = d;
    });

    return byName;
  };
  const moved = (r, x) => ({ ...r, path: ['Path', { segments: [[x, 50], [x + 20, 70], [x + 40, 50]], closed: true }] });

  it('a removed region becomes a backup, the others are untouched', async function () {
    await save(agentA, [r1, a1]);
    await save(agentB, [r1, b1]);
    const before = await currentByName();
    await save(agentB, [b1], [r1.uid]);

    const after = await currentByName();
    assert.deepEqual(Object.keys(after).sort(), ['a1', 'b1'], 'current slice');
    assert.equal(String(after.a1._id), String(before.a1._id), 'a1 untouched');
    assert.equal(String(after.b1._id), String(before.b1._id), 'b1 untouched');
    const backups = (await load(agentA, true)).filter((d) => d.backup);
    assert.deepEqual(backups.map((d) => String(d._id)), [String(before.r1._id)], 'r1 is the only backup');
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('the last save of a region wins, no other region is touched', async function () {
    await save(agentA, [r1, a1]);
    await save(agentB, [r1, b1]);
    const before = await currentByName();
    await save(agentA, [moved(r1, 300), a1]);
    await save(agentB, [moved(r1, 400), b1]);

    const after = await currentByName();
    assert.deepEqual(Object.keys(after).sort(), ['a1', 'b1', 'r1'], 'current slice');
    assert.equal(after.r1.user, userB.username, 'r1 saved last by B');
    assert.equal(after.r1.annotation.path[1].segments[0][0], 400, "B's version of r1 is current");
    assert.equal(String(after.a1._id), String(before.a1._id), 'a1 untouched');
    assert.equal(String(after.b1._id), String(before.b1._id), 'b1 untouched');
    const r1Backups = (await load(agentA, true)).filter((d) => d.backup && d.annotation.uid === r1.uid);
    assert.deepEqual(
      r1Backups.map((d) => [d.user, d.annotation.path[1].segments[0][0]]).sort(),
      [[userA.username, 0], [userA.username, 300]],
      "r1's first version and A's change are backups"
    );
  }).timeout(U.shortTimeout);

  it('a region loaded with GET /api and saved back unchanged keeps its _id and user', async function () {
    await save(agentA, [r1]);
    const [loaded] = await load(agentB);
    await save(agentB, [loaded.annotation, b1]);

    const after = await currentByName();
    assert.equal(String(after.r1._id), String(loaded._id), 'same document');
    assert.equal(after.r1.user, userA.username, 'still A');
    assert.equal(after.b1.user, userB.username);
  }).timeout(U.shortTimeout);

  // Older data has regions stored without annotation.uid. The viewer gives
  // such a region String(_id) as uid when it loads it, and the save keys the
  // document by its _id.
  describe('a region stored without uid', function () {
    let legacy;
    beforeEach(async function () {
      const [doc] = await U.insertAnnotations([
        {
          fileID: `${source}&slice=${slice}`,
          user: userA.username,
          project: project.shortname,
          Hash: 'upload',
          annotation: { name: 'legacy', path: r1.path }
        }
      ]);
      legacy = { name: 'legacy', path: r1.path, uid: String(doc._id) };
    });

    it('sent back unchanged: the same single current document', async function () {
      await save(agentB, [legacy, b1]);
      await save(agentB, [legacy, b1]);
      const docs = (await load(agentA)).filter((d) => d.annotation.name === 'legacy');
      assert.deepEqual(docs.map((d) => String(d._id)), [legacy.uid], 'one current document, same _id');
      assert.equal(docs[0].user, userA.username);
    }).timeout(U.shortTimeout);

    it('changed: one current document, the old one a backup', async function () {
      await save(agentB, [moved(legacy, 300)]);
      await save(agentB, [moved(legacy, 300)]);
      const all = (await load(agentA, true)).filter((d) => d.annotation.name === 'legacy');
      const now = all.filter((d) => !d.backup);
      assert.equal(now.length, 1, 'one current document');
      assert.equal(now[0].annotation.uid, legacy.uid, 'stored with the uid the viewer gave it');
      assert.equal(now[0].user, userB.username);
      assert.deepEqual(all.filter((d) => d.backup).map((d) => String(d._id)), [legacy.uid], 'the old document is the backup');
    }).timeout(U.shortTimeout);

    it('removed: backed up', async function () {
      await save(agentB, [b1], [legacy.uid]);
      assert.deepEqual(names(await load(agentA)), ['b1'], 'current slice');
      const backups = (await load(agentA, true)).filter((d) => d.backup);
      assert.deepEqual(backups.map((d) => String(d._id)), [legacy.uid]);
    }).timeout(U.shortTimeout);
  });

  // Records the API upload's behaviour, unchanged by the editor-save rule: a
  // save replaces the whole slice (every user's current regions become
  // backups) with the uploaded regions, under the uploader's name.
  it('an upload with action=save after another user\'s save replaces the slice, as before', async function () {
    await save(agentA, [r1, a1]);
    const res = await agentB.post('/api/upload')
      .query({ action: 'save', source, slice, project: project.shortname, Hash: 'csaveupload' })
      .attach('data', Buffer.from(JSON.stringify([{ annotation: { name: 'u1', path: r1.path } }])), 'u1.json');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await currentByName();
    assert.deepEqual(Object.keys(after), ['u1'], 'current slice');
    assert.equal(after.u1.user, userB.username);
    const backups = (await load(agentA, true)).filter((d) => d.backup);
    assert.deepEqual(names(backups), ['a1', 'r1'], "A's regions are backups");
  }).timeout(U.shortTimeout);
});
