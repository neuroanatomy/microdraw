/* eslint-disable max-lines */
'use strict';

const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  Text layers step 4 (2026-11-09): on the project page, a logged-in user whom
  GET /api/permissions allows to edit the annotations edits a text layer's
  value in place (POST /api/text-annotation); everyone else keeps read-only
  cells (step 3), and a click on them still opens the row's file.
*/
const CAT = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const SAVE_ROUTE = '/api/text-annotation';
const PERMISSIONS_ROUTE = '/api/permissions';
const IMG_VALUE = '<img src=x onerror="window.tl4Injected=true">';
const viewer = { username: 'e2e-text-viewer', password: 'e2e-text-viewer-password' };

// Files visible to anyone, annotations visible to anyone; `collaborators` adds
// named users with their annotation access; `anyone` sets anyone's.
const textProject = (shortname, { anyone = 'view', collaborators = [] } = {}) => {
  const project = U.createProjectWithPermission(shortname, {});
  project.collaborators.list[0].access = { collaborators: 'none', annotations: anyone, files: 'view' };
  for (const [username, annotations] of collaborators) {
    project.collaborators.list.push({
      username,
      userID: username,
      name: username,
      access: { collaborators: 'none', annotations, files: 'view' }
    });
  }
  project.files.list = [
    { source: CAT, name: 'cat' },
    { source: ZARR, name: 'cat-zarr' }
  ];
  project.annotations.list = [
    { type: 'text', name: 'Notes', values: null, display: true },
    { type: 'vectorial', name: 'Regions', values: 'Set I', display: true },
    { type: 'text', name: 'Progress', values: null, display: true }
  ];

  return project;
};

const editProject = textProject('e2etexteditor', { collaborators: [[H.annotator.username, 'edit'], [viewer.username, 'view']] });
const anyoneProject = textProject('e2etextanyone', { anyone: 'edit' });
const projects = [editProject, anyoneProject];
const shortnames = projects.map((p) => p.shortname);

const projectURL = (p, source) => U.url(`/project/${p.shortname}?source=${encodeURIComponent(source)}&project=${p.shortname}`);
// row 1 is cat, row 2 cat-zarr; column 1 name, 2 file, 3 Notes, 4 Progress
const cellSelector = (row, col) => `#projectFiles tbody tr:nth-child(${row}) td:nth-child(${col})`;
const NOTES = 3;
const PROGRESS = 4;

const textAnnotations = () => U.getDB().collection('textAnnotations');
const storedDocs = (project, source, layer) => textAnnotations()
  .find({ project: project.shortname, source, layer })
  .sort({ _id: 1 })
  .toArray();

const cellState = (page, selector) => page.$eval(selector, (td) => ({
  text: td.textContent,
  title: td.getAttribute('title'),
  classes: [...td.classList],
  tabindex: td.getAttribute('tabindex'),
  label: td.getAttribute('aria-label'),
  input: td.querySelector('input') !== null
}));
const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;

  return { tag: el.tagName, value: el.value, label: el.getAttribute('aria-label') };
});

// eslint-disable-next-line max-statements
describe('Project page edits the values of text layers in place (text layers step 4)', function () {
  let editorContext, viewerContext, visitorContext;
  let page;
  const pageErrors = [];
  const posts = [];
  const permissionRequests = [];
  const navigations = [];

  // Every page records its errors, its POSTs to the save route, its
  // permission requests and its navigations
  const watch = (p) => {
    p.on('pageerror', (err) => pageErrors.push(err.message));
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(SAVE_ROUTE)) { posts.push(req.postData()); }
      if (req.url().includes(PERMISSIONS_ROUTE)) { permissionRequests.push(req.url()); }
      if (req.isNavigationRequest() && req.frame() === p.mainFrame()) { navigations.push(req.url()); }
    });
  };
  const newPage = async (context) => {
    const p = await context.newPage();
    await p.setViewport({ width: U.width, height: U.height });
    watch(p);

    return p;
  };

  before(async function () {
    await Promise.all(projects.map((p) => U.insertProject({ ...p })));
    await textAnnotations().insertOne({
      project: editProject.shortname,
      source: CAT,
      layer: 'Notes',
      value: 'first note',
      user: 'e2e-text-edit',
      modified: new Date('2026-11-09T10:00:00Z')
    });
    editorContext = await H.newContext();
    viewerContext = await H.newContext();
    visitorContext = await H.newContext();
    page = await newPage(editorContext);
    await H.logIn(page);
  });

  beforeEach(function () {
    pageErrors.length = 0;
    posts.length = 0;
    permissionRequests.length = 0;
    navigations.length = 0;
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(editorContext);
      await H.closeContext(viewerContext);
      await H.closeContext(visitorContext);
    } finally {
      await Promise.all([
        ...shortnames.map((s) => U.removeProject(s)),
        textAnnotations().deleteMany({ project: { $in: shortnames } }),
        U.removeLocalUser(viewer.username)
      ]);
    }
  });

  // Open a project page and wait until its values are shown and, for an
  // editor, its text cells are editable
  const open = async (p, project, source, { editable = true } = {}) => {
    const values = p.waitForResponse((res) => res.url().includes('/text-annotations'), { timeout: U.shortTimeout });
    await p.goto(projectURL(project, source), { waitUntil: 'load' });
    await values;
    if (editable) {
      await p.waitForSelector('#projectFiles td.editable', { timeout: U.shortTimeout });
    }
    await H.settleFrames(p);
    navigations.length = 0;
  };
  const saved = (p) => p.waitForResponse((res) => res.url().includes(SAVE_ROUTE) && res.request().method() === 'POST', { timeout: U.shortTimeout });
  // Wait until the page has handled the save's answer
  const notSaving = (p, selector) => p.waitForFunction((sel) => !document.querySelector(sel).classList.contains('saving'), { timeout: U.shortTimeout }, selector);
  // Wait long enough for a navigation request to start, if one was made
  const noNavigation = async () => {
    await U.delay(500);
    assert.deepEqual(navigations, [], 'the page navigated');
  };

  // eslint-disable-next-line max-statements
  it('an editor sees editable cells; Enter saves, the reload shows the value and the old one is a backup', async function () {
    await open(page, editProject, CAT);
    const before = await cellState(page, cellSelector(1, NOTES));
    assert.equal(before.tabindex, '0');
    assert.equal(before.label, 'Edit Notes for cat');
    assert.include(before.classes, 'editable');
    assert.equal(before.text, 'first note');

    await page.click(cellSelector(1, NOTES));
    const active = await activeInfo(page);
    assert.equal(active.tag, 'INPUT');
    assert.equal(active.value, 'first note');
    assert.isTrue(await page.evaluate(() => document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 'first note'.length), 'the value is not selected');
    await page.keyboard.type('second note');
    const answer = saved(page);
    await page.keyboard.press('Enter');
    assert.equal((await answer).status(), 200);
    await notSaving(page, cellSelector(1, NOTES));
    assert.deepEqual(posts.map((b) => JSON.parse(b)), [{ project: editProject.shortname, source: CAT, layer: 'Notes', value: 'second note' }]);
    const after = await cellState(page, cellSelector(1, NOTES));
    assert.equal(after.text, 'second note');
    assert.isFalse(after.input);
    assert.notInclude(after.classes, 'saving');

    await open(page, editProject, CAT);
    assert.equal((await cellState(page, cellSelector(1, NOTES))).text, 'second note');
    const docs = await storedDocs(editProject, CAT, 'Notes');
    assert.deepEqual(docs.map((d) => [d.value, d.backup === true]), [['first note', true], ['second note', false]]);
    assert.equal(docs[1].user, H.annotator.username);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('leaving the input saves', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(2, NOTES));
    await page.keyboard.type('saved on blur');
    const answer = saved(page);
    await page.click('#projectFiles thead th');
    assert.equal((await answer).status(), 200);
    await notSaving(page, cellSelector(2, NOTES));
    assert.equal((await cellState(page, cellSelector(2, NOTES))).text, 'saved on blur');
    const docs = await storedDocs(editProject, ZARR, 'Notes');
    assert.deepEqual(docs.map((d) => d.value), ['saved on blur']);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('Escape cancels and sends nothing; an unchanged value sends nothing', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(1, PROGRESS));
    await page.keyboard.type('not kept');
    await page.keyboard.press('Escape');
    await H.settleFrames(page);
    const cancelled = await cellState(page, cellSelector(1, PROGRESS));
    assert.isFalse(cancelled.input);
    assert.equal(cancelled.text, '');
    assert.include(cancelled.classes, 'empty');

    await page.click(cellSelector(1, NOTES));
    await page.keyboard.press('Enter');
    await page.click(cellSelector(1, NOTES));
    await page.click('#projectFiles thead th');
    await U.delay(500);
    assert.deepEqual(posts, []);
    assert.equal((await cellState(page, cellSelector(1, NOTES))).text, 'second note');
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  it('clicking an editable cell does not open its file; clicking the name cell does', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(2, PROGRESS));
    await noNavigation();
    assert.isTrue((await cellState(page, cellSelector(2, PROGRESS))).input);
    await page.keyboard.press('Escape');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.click(cellSelector(2, 1))
    ]);
    assert.include(page.url(), `source=${encodeURIComponent(ZARR)}`);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('ArrowDown while editing does not open another file; outside an input it still does', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(1, PROGRESS));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await noNavigation();
    assert.isTrue((await cellState(page, cellSelector(1, PROGRESS))).input);
    // Escape gives the focus back to the cell: the arrows move again
    await page.keyboard.press('Escape');
    assert.equal((await activeInfo(page)).tag, 'TD');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.keyboard.press('ArrowDown')
    ]);
    assert.include(page.url(), `source=${encodeURIComponent(ZARR)}`);
    assert.deepEqual(posts, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('keyboard: Tab reaches the next editable cell, Enter opens its input', async function () {
    await open(page, editProject, CAT);
    await page.focus(cellSelector(1, NOTES));
    await page.keyboard.press('Tab');
    assert.equal((await activeInfo(page)).label, 'Edit Progress for cat');
    await page.keyboard.press('Enter');
    const active = await activeInfo(page);
    assert.equal(active.tag, 'INPUT');
    assert.equal(active.value, '');
    assert.deepEqual(navigations, []);
    await page.keyboard.press('Escape');
    // F2 opens it too
    await page.keyboard.press('F2');
    assert.equal((await activeInfo(page)).tag, 'INPUT');
    await page.keyboard.press('Escape');
    assert.deepEqual(posts, []);
  }).timeout(U.mediumTimeout);

  it('a value holding HTML is shown as text after saving, and none of it runs', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(2, PROGRESS));
    await page.keyboard.type(IMG_VALUE);
    const answer = saved(page);
    await page.keyboard.press('Enter');
    assert.equal((await answer).status(), 200);
    await notSaving(page, cellSelector(2, PROGRESS));
    const state = await page.evaluate((sel) => ({
      injected: typeof window.tl4Injected,
      images: document.querySelectorAll('img[src="x"]').length,
      text: document.querySelector(sel).textContent
    }), cellSelector(2, PROGRESS));
    assert.deepEqual(state, { injected: 'undefined', images: 0, text: IMG_VALUE });
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('a save answered 500 keeps the typed text, with the error style and message, and no page error', async function () {
    await open(page, editProject, CAT);
    const onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) { return; }
      if (req.url().includes(SAVE_ROUTE)) {
        req.respond({ status: 500, contentType: 'application/json', body: '{"error":"test failure"}' });
      } else {
        req.continue();
      }
    };
    await page.setRequestInterception(true);
    page.on('request', onRequest);
    try {
      await page.click(cellSelector(2, NOTES));
      await page.keyboard.type('refused text');
      const answer = saved(page);
      await page.keyboard.press('Enter');
      assert.equal((await answer).status(), 500);
      await notSaving(page, cellSelector(2, NOTES));
    } finally {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    }
    const cell = await cellState(page, cellSelector(2, NOTES));
    assert.equal(cell.text, 'refused text');
    assert.include(cell.classes, 'error');
    assert.include(cell.title, 'test failure');
    assert.include(cell.classes, 'editable');
    assert.deepEqual(pageErrors, []);
    // still editable: the input opens on the typed text
    await page.click(cellSelector(2, NOTES));
    assert.equal((await activeInfo(page)).value, 'refused text');
    await page.keyboard.press('Escape');
    // nothing stored
    assert.deepEqual((await storedDocs(editProject, ZARR, 'Notes')).map((d) => d.value), ['saved on blur']);
  }).timeout(U.mediumTimeout);

  it('10 001 characters cannot be typed (maxlength 10 000)', async function () {
    await open(page, editProject, CAT);
    await page.click(cellSelector(1, PROGRESS));
    assert.equal(await page.$eval(`${cellSelector(1, PROGRESS)} input`, (input) => input.maxLength), 10000);
    await page.keyboard.sendCharacter('x'.repeat(10001));
    assert.equal((await activeInfo(page)).value.length, 10000);
    await page.keyboard.press('Escape');
    assert.deepEqual(posts, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('read only: a view-only collaborator gets no input, a click opens the file, nothing is posted', async function () {
    const viewerPage = await newPage(viewerContext);
    await H.logIn(viewerPage, viewer);
    permissionRequests.length = 0;
    const permissions = viewerPage.waitForResponse((res) => res.url().includes(PERMISSIONS_ROUTE), { timeout: U.shortTimeout });
    await open(viewerPage, editProject, CAT, { editable: false });
    await permissions;
    await H.settleFrames(viewerPage);
    assert.equal(permissionRequests.length, 1);
    const cell = await cellState(viewerPage, cellSelector(2, NOTES));
    assert.isNull(cell.tabindex);
    assert.isNull(cell.label);
    assert.notInclude(cell.classes, 'editable');
    await Promise.all([
      viewerPage.waitForNavigation({ waitUntil: 'load' }),
      viewerPage.click(cellSelector(2, NOTES))
    ]);
    assert.include(viewerPage.url(), `source=${encodeURIComponent(ZARR)}`);
    assert.equal(await viewerPage.$$eval('#projectFiles input', (inputs) => inputs.length), 0);
    assert.deepEqual(posts, []);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('read only: a logged-out visitor, where anyone may edit, gets no input and posts nothing', async function () {
    const visitorPage = await newPage(visitorContext);
    await open(visitorPage, anyoneProject, CAT, { editable: false });
    // logged out: the page does not ask for permissions
    assert.deepEqual(permissionRequests, []);
    const cell = await cellState(visitorPage, cellSelector(2, PROGRESS));
    assert.isNull(cell.tabindex);
    assert.notInclude(cell.classes, 'editable');
    await Promise.all([
      visitorPage.waitForNavigation({ waitUntil: 'load' }),
      visitorPage.click(cellSelector(2, PROGRESS))
    ]);
    assert.include(visitorPage.url(), `source=${encodeURIComponent(ZARR)}`);
    assert.equal(await visitorPage.$$eval('#projectFiles input', (inputs) => inputs.length), 0);
    assert.deepEqual(posts, []);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);
});
