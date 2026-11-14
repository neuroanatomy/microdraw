'use strict';

const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  The project page's tables sort by a click on a column header (2026-11-10),
  with nwl-components' SortableTh and useSortable, as the user page: the files
  table by Name, File and each named text layer (by the value its cell shows),
  the layers table by Name and Label Set. Missing values come last both ways.
  A row is its file: a click opens it, the open file's row stays highlighted,
  and ArrowUp/ArrowDown follow the order on screen.
*/
const CAT = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const MISSING = '/test_data/not-there.json';
const SAVE_ROUTE = '/api/text-annotation';

const sortProject = (() => {
  const project = U.createProjectWithPermission('e2eprojectpagesort', {});
  project.collaborators.list[0].access = { collaborators: 'none', annotations: 'view', files: 'view' };
  project.collaborators.list.push({
    username: H.annotator.username,
    userID: H.annotator.username,
    name: H.annotator.username,
    access: { collaborators: 'none', annotations: 'edit', files: 'view' }
  });
  // the project's order is none of the sorted ones
  project.files.list = [
    { source: ZARR, name: 'beta' },
    { source: CAT, name: 'cat' },
    { source: MISSING, name: 'alpha' }
  ];
  project.annotations.list = [
    { type: 'vectorial', name: 'Regions', values: 'Set B', display: true },
    { type: 'text', name: 'Notes', values: null, display: true },
    { type: 'vectorial', name: 'Areas', values: 'Set A', display: true }
  ];

  return project;
})();

// Notes: cat 'zeta', beta none, alpha 'eta'
const values = [[CAT, 'zeta'], [MISSING, 'eta']];

const projectURL = (source) => U.url(`/project/${sortProject.shortname}?source=${encodeURIComponent(source)}&project=${sortProject.shortname}`);
const textAnnotations = () => U.getDB().collection('textAnnotations');

// One column of a table, as text, row by row (1-based column)
const column = (page, table, col) => page.$$eval(`${table} tbody tr`, (trs, c) => trs.map((tr) => tr.cells[c - 1].textContent.trim()), col);
const ariaSort = (page, table) => page.$$eval(`${table} thead th`, (ths) => ths.map((th) => th.getAttribute('aria-sort')));
const selectedRows = (page, table) => page.$$eval(`${table} tbody tr`, (trs) => trs
  .map((tr, i) => (tr.classList.contains('selected') ? i : -1)).filter((i) => i >= 0));
// The size of each header and of its button, to see that sorting shifts nothing
const headerBoxes = (page, table) => page.$$eval(`${table} thead th`, (ths) => ths.map((th) => [th, th.querySelector('button')]
  .map((el) => {
    const r = el.getBoundingClientRect();

    return [r.left, r.top, r.width, r.height];
  })));
const header = (table, col) => `${table} thead th:nth-child(${col}) button`;
const FILES = '#projectFiles';
const LAYERS = '#vecAnnotations';

/**
 * Run `action` and return the URL of the next top-level navigation, which is
 * answered with 204 No Content: the browser stays on the page.
 * @param {object} page A puppeteer page
 * @param {function} action Async function expected to navigate
 * @returns {Promise<URL>} The URL the page tried to go to
 */
const nextNavigation = async (page, action) => {
  let onRequest;
  const navigation = new Promise((resolve) => {
    onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) { return; }
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        resolve(new URL(req.url()));
        req.respond({ status: 204, body: '' });
      } else {
        req.continue();
      }
    };
  });
  await page.setRequestInterception(true);
  page.on('request', onRequest);
  try {
    await action();

    return await navigation;
  } finally {
    page.off('request', onRequest);
    await page.setRequestInterception(false);
  }
};

// eslint-disable-next-line max-statements
describe('Project page: sortable tables (2026-11-10)', function () {
  let context, page;
  const pageErrors = [];
  const posts = [];

  before(async function () {
    await U.insertProject({ ...sortProject });
    await textAnnotations().insertMany(values.map(([source, value]) => ({
      project: sortProject.shortname, source, layer: 'Notes', value, user: 'e2e-sort', modified: new Date('2026-11-10T10:00:00Z')
    })));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(SAVE_ROUTE)) { posts.push(req.postData()); }
    });
    await H.logIn(page);
  });

  beforeEach(function () {
    pageErrors.length = 0;
    posts.length = 0;
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all([
        U.removeProject(sortProject.shortname),
        textAnnotations().deleteMany({ project: sortProject.shortname })
      ]);
    }
  });

  // Open the page on `source` and wait until the values are shown and the text cells are editable
  const open = async (source) => {
    const loaded = page.waitForResponse((res) => res.url().includes('/text-annotations'), { timeout: U.shortTimeout });
    await page.goto(projectURL(source), { waitUntil: 'load' });
    await loaded;
    await page.waitForSelector(`${FILES} td.editable`, { timeout: U.shortTimeout });
    await H.settleFrames(page);
  };
  const sortBy = async (table, col) => {
    await page.click(header(table, col));
    await H.settleFrames(page);
  };

  // eslint-disable-next-line max-statements
  it('unsorted at first; Name sorts ascending, then descending, with aria-sort', async function () {
    await open(CAT);
    assert.deepEqual(await column(page, FILES, 1), ['beta', 'cat', 'alpha']);
    assert.deepEqual(await ariaSort(page, FILES), ['none', 'none', 'none']);
    const boxes = await headerBoxes(page, FILES);
    await sortBy(FILES, 1);
    assert.deepEqual(await column(page, FILES, 1), ['alpha', 'beta', 'cat']);
    assert.deepEqual(await ariaSort(page, FILES), ['ascending', 'none', 'none']);
    assert.deepEqual(await headerBoxes(page, FILES), boxes, 'the headers moved');
    await sortBy(FILES, 1);
    assert.deepEqual(await column(page, FILES, 1), ['cat', 'beta', 'alpha']);
    assert.deepEqual(await ariaSort(page, FILES), ['descending', 'none', 'none']);
    assert.deepEqual(await headerBoxes(page, FILES), boxes, 'the headers moved');
    assert.deepEqual(await page.$$eval(`${FILES} thead th`, (ths) => ths.map((th) => th.textContent.trim())), ['Name', 'File', 'Notes']);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);

  it('File sorts by the source', async function () {
    await open(CAT);
    await sortBy(FILES, 2);
    assert.deepEqual(await column(page, FILES, 2), [ZARR, CAT, MISSING]);
    assert.deepEqual(await ariaSort(page, FILES), ['none', 'ascending', 'none']);
  }).timeout(U.mediumTimeout);

  it('a text layer sorts by its values, the empty one last both ways', async function () {
    await open(CAT);
    await sortBy(FILES, 3);
    assert.deepEqual(await column(page, FILES, 3), ['eta', 'zeta', '']);
    await sortBy(FILES, 3);
    assert.deepEqual(await column(page, FILES, 3), ['zeta', 'eta', '']);
    assert.deepEqual(await column(page, FILES, 1), ['cat', 'alpha', 'beta']);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('the layers table sorts by Name and Label Set; selecting a layer still works', async function () {
    await open(CAT);
    assert.deepEqual(await ariaSort(page, LAYERS), ['none', 'none']);
    await sortBy(LAYERS, 1);
    assert.deepEqual(await column(page, LAYERS, 1), ['Areas', 'Notes', 'Regions']);
    assert.deepEqual(await ariaSort(page, LAYERS), ['ascending', 'none']);
    // the first layer of the project (Regions) is still the selected one
    assert.deepEqual(await selectedRows(page, LAYERS), [2]);
    await page.click(`${LAYERS} tbody tr:nth-child(1) td:nth-child(1)`);
    assert.deepEqual(await selectedRows(page, LAYERS), [0]);
    // Areas stays selected where Label Set puts it: Set A, Set B, then none
    await sortBy(LAYERS, 2);
    assert.deepEqual(await column(page, LAYERS, 1), ['Areas', 'Regions', 'Notes']);
    assert.deepEqual(await selectedRows(page, LAYERS), [0]);
    await sortBy(LAYERS, 2);
    assert.deepEqual(await column(page, LAYERS, 1), ['Regions', 'Areas', 'Notes']);
    assert.deepEqual(await selectedRows(page, LAYERS), [1]);
    assert.deepEqual(await selectedRows(page, FILES), [1], 'the file selection changed');
  }).timeout(U.mediumTimeout);

  it('after sorting, the open file stays highlighted and a click opens the clicked row\'s file', async function () {
    await open(CAT);
    await sortBy(FILES, 1);
    assert.deepEqual(await selectedRows(page, FILES), [2]);
    const target = await nextNavigation(page, async () => {
      // the open file first: no navigation; then the first row on screen
      await page.click(`${FILES} tbody tr:nth-child(3) td:nth-child(1)`);
      await page.click(`${FILES} tbody tr:nth-child(1) td:nth-child(1)`);
    });
    assert.equal(target.searchParams.get('source'), MISSING);
    assert.equal(target.searchParams.get('project'), sortProject.shortname);
  }).timeout(U.mediumTimeout);

  it('after sorting, ArrowDown and ArrowUp open the next and previous row on screen, wrapping around', async function () {
    // sorted by Name: alpha (MISSING), beta (ZARR), cat (CAT)
    await open(ZARR);
    await sortBy(FILES, 1);
    const down = await nextNavigation(page, () => page.keyboard.press('ArrowDown'));
    assert.equal(down.searchParams.get('source'), CAT);
    const up = await nextNavigation(page, () => page.keyboard.press('ArrowUp'));
    assert.equal(up.searchParams.get('source'), MISSING);
    await open(CAT);
    await sortBy(FILES, 1);
    const wrapped = await nextNavigation(page, () => page.keyboard.press('ArrowDown'));
    assert.equal(wrapped.searchParams.get('source'), MISSING);
  }).timeout(U.mediumTimeout);

  // Read on eec9e71 (before sorting): nwl-components' dist/style.css, with its
  // global `*` rule, made both border-box and the handle 12 x 20 px
  it('the sort stylesheet leaves the page\'s own styles as they were', async function () {
    await open(CAT);
    const style = (sel) => page.$eval(sel, (el) => {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();

      return [c.fontSize, c.color, c.boxSizing, Math.round(r.width), Math.round(r.height)];
    });
    const [title, handle] = [await style('#fontLogo a'), await style('#resizeButton')];
    // the text colour: #e8e8e8, nwl-components 3.0.0's default (#fff before it)
    assert.deepEqual(title.slice(0, 3), ['36px', 'rgb(232, 232, 232)', 'content-box']);
    assert.deepEqual(handle, ['14px', 'rgb(232, 232, 232)', 'content-box', 22, 32]);
    assert.equal((await style('#projectFiles'))[2], 'content-box');
  }).timeout(U.mediumTimeout);

  it('Enter and Space on a focused header sort its column', async function () {
    await open(CAT);
    await page.focus(header(FILES, 2));
    await page.keyboard.press('Enter');
    await H.settleFrames(page);
    assert.deepEqual(await ariaSort(page, FILES), ['none', 'ascending', 'none']);
    await page.keyboard.press('Space');
    await H.settleFrames(page);
    assert.deepEqual(await ariaSort(page, FILES), ['none', 'descending', 'none']);
    assert.deepEqual(await column(page, FILES, 2), [MISSING, CAT, ZARR]);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('editing a cell in a sorted table saves to that row\'s file; the row moves when the input closes', async function () {
    await open(CAT);
    // by Notes: alpha (eta), cat (zeta), beta (empty)
    await sortBy(FILES, 3);
    const cell = `${FILES} tbody tr:nth-child(1) td:nth-child(3)`;
    await page.click(cell);
    await page.keyboard.type('zzz');
    // the order is the same while the input is open
    assert.deepEqual(await column(page, FILES, 1), ['alpha', 'cat', 'beta']);
    assert.isTrue(await page.$eval(cell, (td) => td.querySelector('input') !== null));
    const answer = page.waitForResponse((res) => res.url().includes(SAVE_ROUTE) && res.request().method() === 'POST', { timeout: U.shortTimeout });
    await page.keyboard.press('Enter');
    assert.equal((await answer).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#projectFiles td.saving'), { timeout: U.shortTimeout });
    assert.deepEqual(posts.map((b) => JSON.parse(b)), [{ project: sortProject.shortname, source: MISSING, layer: 'Notes', value: 'zzz' }]);
    // re-sorted: zeta, zzz, then the empty one
    assert.deepEqual(await column(page, FILES, 1), ['cat', 'alpha', 'beta']);
    assert.deepEqual(await column(page, FILES, 3), ['zeta', 'zzz', '']);
    assert.deepEqual(await selectedRows(page, FILES), [0]);
    const stored = await textAnnotations()
      .find({ project: sortProject.shortname, source: MISSING, layer: 'Notes', backup: { $ne: true } })
      .toArray();
    assert.deepEqual(stored.map((d) => d.value), ['zzz']);
    assert.deepEqual(pageErrors, []);
  }).timeout(U.mediumTimeout);
});
