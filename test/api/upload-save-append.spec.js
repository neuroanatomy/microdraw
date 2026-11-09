'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// POST /api/upload (maintainer, 2026-11-09): `save` replaces the uploader's own
// current regions on the slice (they become backups), `append` adds the
// uploaded regions to them; neither touches other users' regions, other slices
// or other projects. Before, append stored each earlier region twice (once as a
// whole document nested under `annotation`), save kept the uploader's earlier
// regions, and both marked other users' regions on the slice as backups.
// eslint-disable-next-line max-statements
describe('POST /api/upload save replaces, append adds (2026-11-09)', function () {
  const source = 'upload-save-append-source';
  const userA = { username: 'usa-user-a', password: 'usa-user-a-password' };
  const userB = { username: 'usa-user-b', password: 'usa-user-b-password' };
  const project = U.createPublicAnnotationProject('uploadsaveappend');
  const otherProject = U.createPublicAnnotationProject('uploadsaveappendother');
  const fileID = (slice) => `${source}&slice=${slice}`;
  const path = ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }];
  const stored = (user, slice, uid, shortname = project.shortname) => ({
    fileID: fileID(slice),
    user: user.username,
    project: shortname,
    Hash: 'seeded',
    annotation: { name: uid, uid, path }
  });
  let token;

  const upload = (action, names) => chai.request(U.serverURL).post('/api/upload')
    .query({ action, source, slice: 0, project: project.shortname, token })
    .attach('data', Buffer.from(JSON.stringify(names.map((name) => ({ annotation: { name, path } })))),
      'annotation.json');

  // every document of the source, current and backup, without _id order effects
  const allDocs = (query) => U.getDB().collection('annotations')
    .find({ fileID: new RegExp(`^${source}&slice=`), ...query })
    .sort({ _id: 1 })
    .toArray();
  const current = (query) => allDocs({ backup: { $exists: false }, ...query });
  const backups = (query) => allDocs({ backup: true, ...query });

  before(async function () {
    await U.insertProject(project);
    await U.insertProject(otherProject);
    const agent = await U.logIn(userA);
    ({ token } = (await agent.get('/token')).body);
    assert.isNotEmpty(token);
  });

  beforeEach(async function () {
    await U.insertAnnotations([
      stored(userA, 0, 'a1'),
      stored(userA, 0, 'a2'),
      stored(userB, 0, 'b1'),
      stored(userA, 1, 'slice1'),
      stored(userA, 0, 'other', otherProject.shortname)
    ]);
  });

  afterEach(async function () {
    await U.removeAnnotations(source);
  });

  after(async function () {
    await U.removeAnnotations(source);
    await U.removeProject(project.shortname);
    await U.removeProject(otherProject.shortname);
    await U.removeLocalUser(userA.username);
  });

  const mine = { fileID: fileID(0), project: project.shortname, user: userA.username };

  it('append adds the upload to the uploader\'s 2 earlier regions: 3 current, none nested, no duplicate uid',
    async function () {
      const res = await upload('append', ['appended']);
      assert.equal(res.status, 200, res.text);
      const docs = await current(mine);
      assert.lengthOf(docs, 3);
      assert.isTrue(docs.every((d) => typeof d.annotation.annotation === 'undefined'), 'no nested document');
      const uids = docs.map((d) => d.annotation.uid);
      assert.equal(new Set(uids).size, 3, `uids ${uids}`);
      assert.sameMembers(docs.map((d) => d.annotation.name), ['a1', 'a2', 'appended']);
      assert.isEmpty(await backups(mine), 'append marks nothing as backup');
    }).timeout(U.shortTimeout);

  it('save replaces the uploader\'s regions: only the upload is current, the 2 earlier ones are backups',
    async function () {
      const res = await upload('save', ['saved']);
      assert.equal(res.status, 200, res.text);
      const docs = await current(mine);
      assert.deepEqual(docs.map((d) => d.annotation.name), ['saved']);
      assert.isUndefined(docs[0].annotation.annotation);
      assert.sameMembers((await backups(mine)).map((d) => d.annotation.uid), ['a1', 'a2']);
    }).timeout(U.shortTimeout);

  for (const action of ['save', 'append']) {
    it(`${action} by user A leaves user B's region on the slice current and unchanged`, async function () {
      const [before] = await current({ user: userB.username });
      const res = await upload(action, ['by a']);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await allDocs({ user: userB.username }), [before]);
    }).timeout(U.shortTimeout);

    it(`${action} on slice 0 changes neither slice 1 nor another project with the same source`, async function () {
      const elsewhere = { $or: [{ fileID: fileID(1) }, { project: otherProject.shortname }] };
      const before = await allDocs(elsewhere);
      assert.lengthOf(before, 2);
      const res = await upload(action, ['on slice 0']);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await allDocs(elsewhere), before);
    }).timeout(U.shortTimeout);
  }
});
