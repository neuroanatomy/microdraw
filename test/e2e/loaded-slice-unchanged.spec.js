/* global Microdraw */
'use strict';

/*
  A slice that is only loaded is unchanged (2026-11-15). Regions are stored
  the way older clients, the API upload and today's text tool store them: a
  text annotation whose colour has no alpha ([r, g, b]), a polygon with its own
  colours. Drawing them sets their colours (_drawRegionsInPaper); before the
  fix the slice's baseline was taken before, so the slice counted as changed
  as soon as it was loaded: another user's save was not shown, and Save sent
  the regions again.
*/
const { assert } = require('chai');
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');

const SOURCE = '/test_data/cat.json';
const project = U.createPublicAnnotationProject('e2eloadedunchanged');
const other = { username: 'e2e-loaded-other', password: 'e2e-loaded-other-password' };
const dataURL = (slice) => U.url(`/data?source=${SOURCE}&project=${project.shortname}&slice=${slice}`);
const fileID = (slice) => `${SOURCE}&slice=${slice}`;

// a text annotation as the text tool stores it: its colour without alpha
const text = (uid) => ({
  uid,
  name: 'textAnnotation',
  path: ['PointText', { applyMatrix: false, matrix: [1, 0, 0, 1, 100, 100], content: 'A note', fillColor: [0.2, 0.4, 0.6], fontSize: 20 }]
});
// a polygon as older clients and the API upload store it: colours of its own
// (no alpha, not the label's), a stroke, a number with many decimals
const polygon = (uid) => ({
  uid,
  name: 'Region 1',
  path: [
    'Path',
    {
      applyMatrix: true,
      segments: [[200.123456789, 300], [300, 300], [250, 400]],
      closed: true,
      fillColor: [0.5, 0.5, 0.5],
      strokeColor: [0, 0, 0],
      strokeWidth: 2
    }
  ]
});
const newRegion = (uid) => ({
  uid,
  name: 'Region 2',
  path: ['Path', { applyMatrix: true, segments: [[400, 300], [500, 300], [450, 400]], closed: true }]
});
const doc = (slice, annotation) => ({ fileID: fileID(slice), user: other.username, project: project.shortname, Hash: 'e2e', annotation });

let context;
let agent;
let page;
let posts;
let errors;

const otherSaves = async (slice, Regions) => {
  const res = await agent.post('/api').send({
    action: 'save',
    source: SOURCE,
    slice,
    project: project.shortname,
    Hash: 'e2eloaded',
    annotation: JSON.stringify({ Regions, RegionsToRemove: [] })
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

const waitForRoom = (slice) => {
  const target = { project: project.shortname, source: SOURCE, slice: String(slice) };

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + U.shortTimeout;
    const check = () => {
      if (wsModule._roomSize(target) === 1) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`room ${JSON.stringify(target)} not joined`));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
};

const changes = (slice) => page.evaluate((s) => Microdraw.sectionChanges(Microdraw.ImageInfo[s]), String(slice));

// Loaded and untouched: unchanged, Save sends nothing, and another user's
// save of the slice is shown without a reload.
// eslint-disable-next-line max-statements
const checkUnchanged = async (slice, stored) => {
  await U.insertAnnotations([doc(slice, stored)]);
  page = await context.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api') { posts.push(req.postData()); }
  });
  await page.setViewport({ width: U.width, height: U.height });
  await H.openData(page, dataURL(slice));
  await waitForRoom(slice);
  assert.deepEqual(await page.evaluate((s) => Microdraw.ImageInfo[s].Regions.map((r) => r.uid), String(slice)), [stored.uid]);
  assert.isNull(await changes(slice), 'unchanged once loaded');

  // Save: nothing to send
  await (await page.evaluateHandle(() => Microdraw.dom.querySelector('#save'))).click();
  await page.waitForFunction(() => Microdraw.dom.querySelector('#saveDialog').textContent.includes('No changes to save'), { polling: 50, timeout: U.shortTimeout });
  assert.deepEqual(posts, [], 'no save sent');

  // another user's save is shown
  await otherSaves(String(slice), [newRegion(`${stored.uid}-new`)]);
  await page.waitForFunction(
    (s, u) => Microdraw.ImageInfo[s].Regions.some((r) => r.uid === u),
    { polling: 50, timeout: U.shortTimeout }, String(slice), `${stored.uid}-new`
  );
  assert.isNull(await changes(slice), 'unchanged after the live update');

  // an edit still counts as a change, and Save sends it
  await page.evaluate((s) => { Microdraw.ImageInfo[s].Regions[0].path.translate([10, 0]); }, String(slice));
  assert.isNotNull(await changes(slice), 'an edit is a change');
  await H.waitForSave(page, async () => (await page.evaluateHandle((sel) => Microdraw.dom.querySelector(sel), UI.SAVE)).click());
  assert.lengthOf(posts, 1, 'the edit is saved');
  assert.isNull(await changes(slice), 'unchanged once saved');
  assert.deepEqual(errors, []);
};

describe('A slice that is only loaded is unchanged (2026-11-15)', () => {
  before(async () => {
    await U.removeProject(project.shortname);
    await U.insertProject(project);
    agent = await U.logIn(other);
    context = await H.newContext();
    const p = await context.newPage();
    await H.logIn(p);
    await p.close();
  });

  beforeEach(async () => {
    posts = [];
    errors = [];
    await U.removeProjectAnnotations(project.shortname);
  });

  afterEach(async () => {
    if (page) { await page.close(); }
    page = null;
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
      await U.removeLocalUser(other.username);
    }
  });

  it('a text annotation stored without alpha', async () => {
    await checkUnchanged(0, text('loaded-text'));
  }).timeout(U.longTimeout);

  it('a polygon stored with colours of its own', async () => {
    await checkUnchanged(1, polygon('loaded-polygon'));
  }).timeout(U.longTimeout);
});
