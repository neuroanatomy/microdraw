/* global Microdraw */
'use strict';

const { assert } = require('chai');
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');

// The editor save applies only its changes, region by region (2026-10-29). A
// region the viewer loaded and sends back untouched (paper.js exportJSON of
// the loaded path) must compare equal to the stored one, so that another
// user's save leaves its document, _id and user as they are.
// eslint-disable-next-line max-statements
describe('Viewer save: a loaded region sent back untouched is left as it is', () => {
  const project = U.createPublicAnnotationProject('e2esaveroundtrip');
  const userB = { username: 'e2e-roundtrip-b', password: 'e2e-roundtrip-b-password' };
  // a function: the server's port is known only once the runner has started it
  const pageUrl = () => U.url(`/data?source=/test_data/cat.json&project=${project.shortname}&slice=0`);
  const fileID = '/test_data/cat.json&slice=0';
  let contextA;
  let contextB;

  const shadowclick = async (page, sel) => {
    const handle = await page.evaluateHandle(`document.querySelector("#content").shadowRoot.querySelector("${sel}")`);
    await handle.click();
  };

  const drawAndSave = async (page, points) => {
    await shadowclick(page, UI.DRAWPOLYGON);
    for (const [x, y] of points) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(x, y);
    }
    await H.waitForSave(page, () => shadowclick(page, UI.SAVE));
  };

  const current = () => U.findAnnotations({ fileID, project: project.shortname, backup: { $exists: false } });

  before(async () => {
    await U.removeProject(project.shortname);
    await U.insertProject(project);
    contextA = await H.newContext();
    contextB = await H.newContext();
  });

  after(async () => {
    try {
      await H.closeContext(contextA);
      await H.closeContext(contextB);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
      await U.removeLocalUser(userB.username);
    }
  });

  // eslint-disable-next-line max-statements
  it("B's save keeps A's region: same _id, user and path", async () => {
    const pageA = await contextA.newPage();
    await pageA.setViewport({ width: U.width, height: U.height });
    await H.logIn(pageA);
    await H.openData(pageA, pageUrl());
    await drawAndSave(pageA, [[300, 100], [400, 100], [350, 200], [300, 100]]);
    const [savedByA] = await current();
    assert.equal(savedByA.user, H.annotator.username);

    const pageB = await contextB.newPage();
    await pageB.setViewport({ width: U.width, height: U.height });
    await H.logIn(pageB, userB);
    await H.openData(pageB, pageUrl());
    assert.equal(await pageB.evaluate(() => Microdraw.ImageInfo[0].Regions.length), 1, "B loaded A's region");
    await drawAndSave(pageB, [[400, 300], [500, 300], [500, 400], [400, 400], [400, 300]]);

    const docs = await current();
    assert.equal(docs.length, 2, 'two current regions');
    const kept = docs.find((d) => d.annotation.uid === savedByA.annotation.uid);
    assert.equal(String(kept._id), String(savedByA._id), "A's document was not rewritten");
    assert.equal(kept.user, H.annotator.username);
    assert.deepEqual(kept.annotation, savedByA.annotation);
    const added = docs.find((d) => d.annotation.uid !== savedByA.annotation.uid);
    assert.equal(added.user, userB.username);
    assert.isEmpty(await U.findAnnotations({ fileID, project: project.shortname, backup: true }), 'no backup');
  }).timeout(U.longTimeout);

  // A region stored without annotation.uid (older data) takes String(_id) as
  // uid in the viewer, so two saves of its slice leave one document for it.
  // eslint-disable-next-line max-statements
  it('a region stored without uid stays one document over two saves', async () => {
    await U.removeProjectAnnotations(project.shortname);
    const [legacy] = await U.insertAnnotations([
      {
        fileID,
        user: userB.username,
        project: project.shortname,
        Hash: 'upload',
        annotation: { name: 'legacy', path: ['Path', { segments: [[100, 100], [200, 100], [150, 200]], closed: true }] }
      }
    ]);
    const page = await contextA.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, pageUrl());
    const legacyDocs = async () => (await current()).filter((d) => d.annotation.name === 'legacy');
    await drawAndSave(page, [[300, 100], [400, 100], [350, 200], [300, 100]]);
    // The first save rewrites it once: the viewer adds its style (fill,
    // stroke) to a path stored without one, so it is no longer equal.
    const [afterFirst, ...more] = await legacyDocs();
    assert.isEmpty(more, 'one current document after the first save');
    assert.equal(afterFirst.annotation.uid, String(legacy._id), 'stored with the uid the viewer gave it');
    await drawAndSave(page, [[400, 300], [500, 300], [500, 400], [400, 400], [400, 300]]);

    const docs = await legacyDocs();
    assert.deepEqual(docs.map((d) => String(d._id)), [String(afterFirst._id)], 'the same document, alone, after the second');
  }).timeout(U.longTimeout);
});
