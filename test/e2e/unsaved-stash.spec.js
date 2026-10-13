/* global Microdraw */
'use strict';

/*
  H3a: saving needs a project and a logged-in user. Otherwise the viewer sends
  nothing, says why, and keeps the user's own work (regions created or modified
  on this page, not those loaded from the server) in localStorage: the "stash",
  decisions.md D25. A save the server refuses keeps it too. Opening the image in
  a project the user can edit, and that lists the image, offers to import it.
*/
const chai = require('chai');
const { assert } = chai;
const UI = require('../UI');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const PREFIX = 'microdraw:unsaved:';
const editable = U.createPublicAnnotationProject('e2eh3stashedit');
const viewOnly = U.createPublicAnnotationProject('e2eh3stashview');
viewOnly.collaborators.list[0].access.annotations = 'view';
const unlisted = U.createPublicAnnotationProject('e2eh3stashunlisted');
unlisted.files.list = [{ source: '/test_data/cat-zarr.json', name: 'cat-zarr' }];
const dataURL = (project) => U.url(`/data?source=${SOURCE}${project ? `&project=${project.shortname}` : ''}&slice=0`);

// Two annotations another user saved on the image outside a project, before H3.
const path = ['Path', { segments: [[1000, 1000], [1500, 1000], [1250, 1500]], closed: true }];
const outOfProject = ['other-unchanged', 'other-modified'].map((uid) => ({
  fileID: `${SOURCE}&slice=0`, user: 'e2e-h3-someone-else', project: '', Hash: 'old', annotation: { name: uid, uid, path }
}));

let context;
let page;

const shadowclick = async (sel, p = page) => {
  const handle = await p.evaluateHandle((s) => document.querySelector('#content').shadowRoot.querySelector(s), sel);
  await handle.click();
};

const drawTriangle = async (p = page) => {
  await H.settleFrames(p);
  await shadowclick(UI.DRAWPOLYGON, p);
  await p.mouse.click(300, 100);
  await p.mouse.click(400, 100);
  await p.mouse.click(350, 200);
  await p.mouse.click(300, 100);
};

// The stash entries in the page's localStorage, by key.
const stashes = (p = page) => p.evaluate((prefix) => {
  const result = {};
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(prefix)) { result[key] = JSON.parse(window.localStorage.getItem(key)); }
  }

  return result;
}, PREFIX);

const dialogText = (id, p = page) => p.evaluate((i) => {
  const el = Microdraw.dom.querySelector(i);

  return getComputedStyle(el).display === 'none' ? null : el.textContent;
}, id);

const dialogButtons = (id) => page.evaluate((i) => [...Microdraw.dom.querySelectorAll(`${i} button`)].map((b) => b.dataset.action), id);

const waitForDialog = (id, pattern, p = page) => p.waitForFunction((i, re) => {
  const el = Microdraw.dom.querySelector(i);

  return getComputedStyle(el).display !== 'none' && new RegExp(re).test(el.textContent);
}, { polling: 50, timeout: U.shortTimeout }, id, pattern);

// The stash check runs after the slice's annotations are loaded; wait for its result.
const stashCheck = async () => {
  await page.waitForFunction(() => window.UnsavedStash && window.UnsavedStash.lastCheck, { polling: 50, timeout: U.shortTimeout });

  return page.evaluate(() => window.UnsavedStash.lastCheck);
};

const clickDialogButton = (action) => page.evaluate((a) => {
  Microdraw.dom.querySelector(`#importDialog button[data-action="${a}"]`).click();
}, action);

const regionNames = () => page.evaluate(() => Microdraw.ImageInfo[Microdraw.currentImage].Regions.map((r) => r.name));

// Record the POST /api requests a function triggers.
const postsDuring = async (p, action) => {
  const posts = [];
  const onRequest = (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api') { posts.push(req.postData()); }
  };
  p.on('request', onRequest);
  await action();
  p.off('request', onRequest);

  return posts;
};

// eslint-disable-next-line max-statements
describe('Unsaved annotations are kept in the browser (H3a)', () => {
  let stashKey;
  let stashCopy;

  before(async () => {
    // annotations left on the image outside a project by earlier runs
    await U.removeAnnotations(SOURCE);
    await U.insertAnnotations(outOfProject.map((a) => ({ ...a })));
    await Promise.all([editable, viewOnly, unlisted].map((p) => U.insertProject(p)));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.logIn(page);
  });

  after(async () => {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeAnnotations(SOURCE);
      await Promise.all([editable, viewOnly, unlisted].map((p) => U.removeProject(p.shortname)));
    }
  });

  // eslint-disable-next-line max-statements
  it('saving without a project shows the dialog, sends nothing, and stashes only the user\'s own work', async () => {
    await H.openData(page, dataURL());
    assert.sameMembers(await regionNames(), ['other-unchanged', 'other-modified']);
    // modify one of the loaded regions, draw a new one
    await page.evaluate(() => {
      const reg = Microdraw.ImageInfo[Microdraw.currentImage].Regions.find((r) => r.uid === 'other-modified');
      reg.path.translate(new window.paper.Point(50, 0));
    });
    await drawTriangle();
    const posts = await postsDuring(page, async () => {
      await shadowclick(UI.SAVE);
      await waitForDialog('#saveDialog', 'Saving annotations requires a project');
    });
    await H.waitForTools(page);

    assert.lengthOf(posts, 0, 'a save request was sent to /api');
    assert.include(await dialogText('#saveDialog'), 'kept in this browser');
    const link = await page.evaluate(() => Microdraw.dom.querySelector('#saveDialog a').getAttribute('href'));
    assert.equal(link, '/project/new');

    const all = await stashes();
    assert.lengthOf(Object.keys(all), 1);
    [stashKey] = Object.keys(all);
    assert.match(stashKey, /^microdraw:unsaved:\/test_data\/cat\.json&slice=/);
    const stash = all[stashKey];
    assert.equal(stash.source, SOURCE);
    assert.isFalse(Number.isNaN(Date.parse(stash.savedAt)));
    const uids = stash.annotation.Regions.map((r) => r.uid);
    assert.lengthOf(uids, 2);
    assert.include(uids, 'other-modified');
    assert.notInclude(uids, 'other-unchanged', 'a region loaded from the server, unchanged, was stashed');
    stashCopy = stash;

    // the dialog stays until it is closed
    await page.evaluate(() => Microdraw.dom.querySelector('#saveDialog button[data-action="close"]').click());
    assert.isNull(await dialogText('#saveDialog'));
  }).timeout(U.mediumTimeout);

  it('a view-only project does not offer the import', async () => {
    await H.openData(page, dataURL(viewOnly));
    assert.deepInclude(await stashCheck(), { key: stashKey, offered: false, reason: 'cannot edit' });
    assert.isNull(await dialogText('#importDialog'));
    assert.hasAllKeys(await stashes(), [stashKey]);
  }).timeout(U.mediumTimeout);

  it('a save refused with 403 says so, and keeps the new region in the stash', async () => {
    await drawTriangle();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api', { timeout: U.shortTimeout }),
      shadowclick(UI.SAVE)
    ]);
    assert.equal(res.status(), 403);
    await waitForDialog('#saveDialog', 'You don\'t have permission to edit annotations in this project\\. Your annotations are kept in this browser\\.');
    assert.lengthOf((await stashes())[stashKey].annotation.Regions, 3);
    await H.waitForTools(page);
  }).timeout(U.mediumTimeout);

  it('an editable project that does not list the image asks to add it, without an import button', async () => {
    await H.openData(page, dataURL(unlisted));
    assert.deepInclude(await stashCheck(), { key: stashKey, offered: false, reason: 'image not in project' });
    await waitForDialog('#importDialog', '^Add this image to the project to import your unsaved annotations\\.');
    assert.notInclude(await dialogButtons('#importDialog'), 'import');
    assert.hasAllKeys(await stashes(), [stashKey]);
    assert.lengthOf(await regionNames(), 0);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('an editable project that lists the image offers the import; accepting adds the regions and clears the stash', async () => {
    await H.openData(page, dataURL(editable));
    assert.deepInclude(await stashCheck(), { key: stashKey, offered: true });
    await waitForDialog('#importDialog', 'You have unsaved annotations for this image from .+\\. Import them into this project\\?');
    assert.lengthOf(await regionNames(), 0);

    await clickDialogButton('import');
    assert.lengthOf(await regionNames(), 3);
    assert.deepEqual(await stashes(), {});
    const unsaved = await page.evaluate(() => Microdraw.sectionHash(Microdraw.ImageInfo[Microdraw.currentImage]) !== Microdraw.ImageInfo[Microdraw.currentImage].Hash);
    assert.isTrue(unsaved, 'the imported regions are not unsaved changes');

    // saved normally, into the project
    await H.waitForSave(page, () => shadowclick(UI.SAVE));
    await H.openData(page, dataURL(editable));
    assert.lengthOf(await regionNames(), 3);
    assert.deepInclude(await stashCheck(), { offered: false, reason: 'no stash' });
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('"Not now" keeps the stash; "Discard" removes it after a confirmation', async () => {
    // a region that is not in the project yet (the earlier ones were imported and saved)
    stashCopy.annotation.Regions = [{ ...stashCopy.annotation.Regions[0], uid: 'e2eh3notimported' }];
    await page.evaluate((key, value) => window.localStorage.setItem(key, JSON.stringify(value)), stashKey, stashCopy);

    await H.openData(page, dataURL(editable));
    await waitForDialog('#importDialog', 'Import them into this project');
    await clickDialogButton('later');
    assert.isNull(await dialogText('#importDialog'));
    assert.hasAllKeys(await stashes(), [stashKey]);
    assert.lengthOf(await regionNames(), 3);

    await H.openData(page, dataURL(editable));
    await waitForDialog('#importDialog', 'Import them into this project');
    await clickDialogButton('discard');
    await waitForDialog('#importDialog', 'cannot be undone');
    assert.hasAllKeys(await stashes(), [stashKey], 'discarded before the confirmation');
    await clickDialogButton('discard');
    assert.isNull(await dialogText('#importDialog'));
    assert.deepEqual(await stashes(), {});
    assert.lengthOf(await regionNames(), 3);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements
  it('logged out, saving sends nothing, asks to log in, and stashes the drawing', async () => {
    const anonymous = await H.newContext();
    try {
      const p = await anonymous.newPage();
      await p.setViewport({ width: U.width, height: U.height });
      await H.openData(p, dataURL(editable));
      await drawTriangle(p);
      const posts = await postsDuring(p, async () => {
        await shadowclick(UI.SAVE, p);
        await waitForDialog('#saveDialog', '^Log in to save your annotations\\. They are kept in this browser\\.', p);
      });
      assert.lengthOf(posts, 0, 'a save request was sent to /api');
      const link = await p.evaluate(() => Microdraw.dom.querySelector('#saveDialog a').getAttribute('href'));
      assert.match(link, /^\/(auth|login)/);
      const all = await stashes(p);
      assert.lengthOf(Object.keys(all), 1);
      assert.lengthOf(Object.values(all)[0].annotation.Regions, 1);
    } finally {
      await anonymous.close();
    }
  }).timeout(U.mediumTimeout);
});
