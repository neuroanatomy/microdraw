/* global Microdraw */
/* eslint-disable max-lines */
'use strict';

/*
  Simultaneous editing, step 2 (2026-10-29): opening a slice that has no
  unsaved changes fetches it again, so the viewer shows what other users saved
  since it was first opened. A slice with unsaved changes keeps its copy in
  memory. When a fresh fetch replaces a slice, its undo and redo steps go: they
  restore a copy from before the fetch. After a successful save the regions it
  removed leave RegionsToRemove, so a later save does not remove them again.
*/
const { assert } = require('chai');
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const project = U.createPublicAnnotationProject('e2efreshslice');
const unlisted = U.createPublicAnnotationProject('e2efreshsliceunlisted');
unlisted.files.list = [{ source: '/test_data/cat-zarr.json', name: 'cat-zarr' }];
const other = { username: 'e2e-fresh-other', password: 'e2e-fresh-other-password' };
const dataURL = (p = project) => U.url(`/data?source=${SOURCE}&project=${p.shortname}&slice=0`);
const fileID = (slice) => `${SOURCE}&slice=${slice}`;
const stashKey = `microdraw:unsaved:${SOURCE}&slice=0`;

const region = (uid, x) => ({
  name: uid,
  uid,
  path: ['Path', { applyMatrix: true, segments: [[x, 300], [x + 100, 300], [x + 50, 400]], closed: true }]
});

let context;
let page;
let agent;

const shadowclick = async (sel) => {
  const handle = await page.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
  await handle.click();
};

const openPage = async (p = project) => {
  page = await context.newPage();
  await page.setViewport({ width: U.width, height: U.height });
  await H.openData(page, dataURL(p));
};

// next or previous slice, and wait until it is shown
const go = async (sel, slice) => {
  await shadowclick(sel);
  await H.waitForMicrodraw(page, slice);
  await H.settleFrames(page);
};

// What the other user's viewer sends (as test/api/concurrent-save.spec.js).
const otherSaves = async (slice, Regions, RegionsToRemove = []) => {
  const res = await agent.post('/api').send({
    action: 'save',
    source: SOURCE,
    slice,
    project: project.shortname,
    Hash: 'e2efresh',
    annotation: JSON.stringify({ Regions, RegionsToRemove })
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

const uids = (slice) => page.evaluate((s) => Microdraw.ImageInfo[s].Regions.map((r) => r.uid).sort(), slice);
const drawnCount = () => page.evaluate(() => window.paper.project.activeLayer.children.length);
const currentUids = async (slice) => (await U.findAnnotations({ fileID: fileID(slice), project: project.shortname, backup: { $exists: false } }))
  .map((d) => d.annotation.uid)
  .sort();

const drawTriangle = async (x = 300) => {
  await shadowclick(UI.DRAWPOLYGON);
  for (const [px, py] of [[x, 100], [x + 100, 100], [x + 50, 200], [x, 100]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.click(px, py);
  }
  await H.waitForTools(page);
};

// The GET /api annotation loads of `slice` while `action` runs.
const loadsDuring = async (slice, action) => {
  const seen = [];
  const onRequest = (req) => {
    const u = new URL(req.url());
    if (req.method() === 'GET' && u.pathname === '/api' && u.searchParams.get('action') === 'load_last' &&
        u.searchParams.get('slice') === slice) {
      seen.push(u.href);
    }
  };
  page.on('request', onRequest);
  try {
    await action();
  } finally {
    page.off('request', onRequest);
  }

  return seen;
};

// Click Save and wait until its dialog has closed; the POST /api sent, if any.
const clickSave = async () => {
  const posts = [];
  const onRequest = (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api') { posts.push(req.postData()); }
  };
  page.on('request', onRequest);
  try {
    await shadowclick(UI.SAVE);
    await page.waitForFunction(() => (/No changes to save|Successfully saved|Unable|permission/).test(Microdraw.dom.querySelector('#saveDialog').textContent), { polling: 50, timeout: U.mediumTimeout });
    await page.waitForFunction(() => getComputedStyle(Microdraw.dom.querySelector('#saveDialog')).display === 'none' &&
      window.__mdTest.pendingToolResets === 0, { polling: 50, timeout: U.mediumTimeout });
  } finally {
    page.off('request', onRequest);
  }

  return posts;
};

// eslint-disable-next-line max-statements
describe('Opening a slice shows what is on the server now', () => {
  before(async () => {
    await U.removeProject(project.shortname);
    await U.removeProject(unlisted.shortname);
    await U.insertProject(project);
    await U.insertProject(unlisted);
    agent = await U.logIn(other);
    context = await H.newContext();
    const p = await context.newPage();
    await H.logIn(p);
    await p.close();
  });

  beforeEach(async () => {
    await U.removeProjectAnnotations(project.shortname);
  });

  afterEach(async () => {
    if (page) {
      await page.evaluate(() => window.localStorage.clear());
      await page.close();
      page = null;
    }
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
      await U.removeProject(unlisted.shortname);
      await U.removeLocalUser(other.username);
    }
  });

  // eslint-disable-next-line max-statements
  it("shows another user's save on a slice visited before", async () => {
    await otherSaves('0', [region('freshfirst', 100)]);
    await openPage();
    assert.deepEqual(await uids('0'), ['freshfirst']);
    await go(UI.NEXT, 1);
    await otherSaves('0', [region('freshother', 300)]);

    await go(UI.PREVIOUS, 0);
    await page.waitForFunction(() => Microdraw.ImageInfo[0].Regions.some((r) => r.uid === 'freshother'), { polling: 50, timeout: U.shortTimeout });
    assert.deepEqual(await uids('0'), ['freshfirst', 'freshother']);
    assert.equal(await drawnCount(), 2, 'drawn');
    // the unsaved-annotations stash compares with the server's regions (H3a)
    assert.deepEqual(await page.evaluate(() => Object.keys(Microdraw.ImageInfo[0].ServerRegions).sort()), ['freshfirst', 'freshother']);
    assert.isNull(await page.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'not changed');
  }).timeout(U.longTimeout);

  it('keeps a slice with unsaved changes as it is, without fetching it', async () => {
    await openPage();
    await drawTriangle();
    const [drawn] = await uids('0');
    await go(UI.NEXT, 1);
    await otherSaves('0', [region('freshother', 500)]);

    const loads = await loadsDuring('0', () => go(UI.PREVIOUS, 0));
    assert.lengthOf(loads, 0, 'no fetch of slice 0');
    assert.deepEqual(await uids('0'), [drawn]);
    assert.equal(await drawnCount(), 1, 'the drawing is shown');
  }).timeout(U.longTimeout);

  it('fetches again a slice without unsaved changes, once per visit', async () => {
    await openPage();
    await drawTriangle();
    await H.waitForSave(page, () => shadowclick(UI.SAVE));
    await go(UI.NEXT, 1);
    const loads = await loadsDuring('0', () => go(UI.PREVIOUS, 0));
    assert.lengthOf(loads, 1);
    assert.lengthOf(await uids('0'), 1);
    assert.isNull(await page.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])), 'not changed after the fetch');
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('a fresh fetch drops the undo steps of its slice: undo and save keep the other user\'s region', async () => {
    await openPage();
    await drawTriangle();
    await H.waitForSave(page, () => shadowclick(UI.SAVE));
    const [mine] = await uids('0');
    assert.isAbove(await page.evaluate(() => Microdraw.UndoStack.filter((u) => u.imageNumber === '0').length), 0, 'undo steps before');
    await go(UI.NEXT, 1);
    await otherSaves('0', [region('freshother', 500)]);

    await go(UI.PREVIOUS, 0);
    await page.waitForFunction(() => Microdraw.ImageInfo[0].Regions.some((r) => r.uid === 'freshother'), { polling: 50, timeout: U.shortTimeout });
    const steps = await page.evaluate(() => [...Microdraw.UndoStack, ...Microdraw.RedoStack].filter((u) => u.imageNumber === '0').length);
    assert.equal(steps, 0, 'undo or redo steps of slice 0 from before the fetch');

    await shadowclick(UI.UNDO);
    await H.waitForTools(page);
    assert.deepEqual(await uids('0'), [mine, 'freshother'].sort(), 'undo changed nothing');
    await clickSave();
    assert.deepEqual(await currentUids(0), [mine, 'freshother'].sort(), 'current on the server');
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('undo on another slice still works while that slice has unsaved changes', async () => {
    await openPage();
    await drawTriangle();
    const drawn = await uids('0');
    await shadowclick(UI.DELETE);
    await H.waitForTools(page);
    assert.deepEqual(await uids('0'), []);
    await go(UI.NEXT, 1);
    const loads = await loadsDuring('0', async () => {
      await shadowclick(UI.UNDO);
      await H.waitForMicrodraw(page, 0);
      await H.settleFrames(page);
    });
    assert.lengthOf(loads, 0, 'no fetch of slice 0');
    assert.deepEqual(await uids('0'), drawn, 'the deletion is undone');
    assert.equal(await drawnCount(), 1);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('a region removed and saved is not removed again by the next save', async () => {
    await otherSaves('0', [region('freshr1', 300)]);
    await openPage();
    assert.deepEqual(await uids('0'), ['freshr1']);

    // B (this page) removes r1 and saves
    await page.evaluate(() => {
      const reg = Microdraw.ImageInfo[0].Regions.find((r) => r.uid === 'freshr1');
      Microdraw.removeRegion(reg, '0');
      window.paper.view.draw();
    });
    await H.waitForSave(page, () => shadowclick(UI.SAVE));
    assert.deepEqual(await currentUids(0), []);
    assert.deepEqual(await page.evaluate(() => Microdraw.ImageInfo[0].RegionsToRemove), [], 'cleared');

    // A saves r1 again
    await otherSaves('0', [region('freshr1', 300)]);

    // B's next save (another change) leaves r1 current
    await drawTriangle();
    const [b2] = await uids('0');
    await H.waitForSave(page, () => shadowclick(UI.SAVE));
    assert.deepEqual(await currentUids(0), [b2, 'freshr1'].sort());

    // and the slice does not look changed: no second save
    assert.isNull(await page.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[0])));
    assert.lengthOf(await clickSave(), 0, 'POST /api sent');
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('a late answer for a slice the user has left does not draw on the next one', async () => {
    await otherSaves('1', [region('freshy', 300)]);
    await openPage();
    await go(UI.NEXT, 1);
    assert.deepEqual(await uids('1'), ['freshy']);
    await otherSaves('0', [region('freshz', 500)]);

    let held = null;
    let seen;
    const heldSeen = new Promise((resolve) => { seen = resolve; });
    const onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) { return; }
      const u = new URL(req.url());
      if (u.pathname === '/api' && u.searchParams.get('action') === 'load_last' && u.searchParams.get('slice') === '0') {
        held = req;
        seen();
      } else {
        req.continue();
      }
    };
    await page.setRequestInterception(true);
    page.on('request', onRequest);
    try {
      await shadowclick(UI.PREVIOUS);
      await heldSeen;
      await shadowclick(UI.NEXT);
      // slice 1 shown, its own fetch answered; only slice 0's is out
      await page.waitForFunction(() => Microdraw.currentImage === '1' && window.__mdTest.pendingApiGets === 1 &&
        Microdraw.viewer.world.getItemCount() === 1 && Microdraw.viewer.world.getItemAt(0).getFullyLoaded(), { polling: 50, timeout: U.mediumTimeout });
      await held.continue();
      await page.waitForFunction(() => window.__mdTest.pendingApiGets === 0, { polling: 50, timeout: U.shortTimeout });
      await H.settleFrames(page);
    } finally {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    }
    assert.equal(await page.evaluate(() => Microdraw.currentImage), '1');
    assert.deepEqual(await uids('1'), ['freshy']);
    assert.equal(await drawnCount(), 1, 'only slice 1 drawn');
  }).timeout(U.longTimeout);

  describe('unsaved-annotations dialog', () => {
    const setStash = () => page.evaluate((key, src) => {
      window.localStorage.setItem(key, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        source: src,
        slice: '0',
        annotation: {
          Regions: [{ name: 'stashed', uid: 'freshstashed', path: ['Path', { segments: [[300, 300], [400, 300], [350, 400]], closed: true }] }],
          RegionsToRemove: []
        }
      }));
    }, stashKey, SOURCE);
    const dialogShown = () => page.evaluate(() => getComputedStyle(Microdraw.dom.querySelector('#importDialog')).display !== 'none');
    const lastCheck = async () => {
      await page.waitForFunction(() => window.UnsavedStash.lastCheck, { polling: 50, timeout: U.shortTimeout });

      return page.evaluate(() => window.UnsavedStash.lastCheck);
    };
    const clickDialog = (action) => page.evaluate((a) => {
      Microdraw.dom.querySelector(`#importDialog button[data-action="${a}"]`).click();
    }, action);
    // back on slice 0 after slice 1: the check that ran after the fresh fetch
    const revisit = async () => {
      await go(UI.NEXT, 1);
      await page.evaluate(() => { window.UnsavedStash.lastCheck = null; });
      await go(UI.PREVIOUS, 0);

      return lastCheck();
    };

    it('"Not now" is not asked again when the slice is fetched again', async () => {
      page = await context.newPage();
      await page.setViewport({ width: U.width, height: U.height });
      await page.goto(U.url('/'), { waitUntil: 'load' });
      await setStash();
      await H.openData(page, dataURL());
      assert.include(await lastCheck(), { offered: true });
      await clickDialog('later');

      assert.include(await revisit(), { offered: false, reason: 'postponed' });
      assert.isFalse(await dialogShown());
    }).timeout(U.longTimeout);

    it('"Add this image to the project", closed, is not shown again when the slice is fetched again', async () => {
      page = await context.newPage();
      await page.setViewport({ width: U.width, height: U.height });
      await page.goto(U.url('/'), { waitUntil: 'load' });
      await setStash();
      await H.openData(page, dataURL(unlisted));
      assert.include(await lastCheck(), { reason: 'image not in project' });
      assert.isTrue(await dialogShown());
      await clickDialog('close');

      assert.include(await revisit(), { offered: false, reason: 'postponed' });
      assert.isFalse(await dialogShown());
    }).timeout(U.longTimeout);
  });
});
