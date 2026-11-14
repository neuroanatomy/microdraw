'use strict';

/*
  Resizable columns (UI kit step 15, nwl-components 3.1.0). Every table with a
  header row has a handle at the right edge of each header: the project page's
  two tables (resizableColumns() from nwl-components/resize, in
  project-page.js) and the tables of the Vue pages (Table.vue resizes by
  default): the user page's projects, the settings page's tables, the admin
  page's orphan list.

  On the project page and the user page: every header has a handle; before any
  drag the columns are as wide as without the helper (handles and wrapper
  taken out by hand, within 0.5px); a mouse drag widens that column only and
  does not sort; ArrowRight on a focused handle adds 10px; a reload gives the
  automatic layout. On the settings and admin pages: every header has a handle.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const SHORTNAME = 'e2eresizecolumns';
const OWNER = 'e2e-resize-columns-owner';
const MISSING = '/test_data/not-there.json';
const CAT = '/test_data/cat.json';
// an orphan annotation, for the admin page's table
const ORPHAN_SOURCE = 'http://resize-columns.localhost/brain.dzi';
const orphan = {
  fileID: `${ORPHAN_SOURCE}&slice=0`,
  user: 'e2e-resize',
  project: '',
  Hash: 'h',
  annotation: { name: 'r1', uid: 'e2e-resize-r1', path: ['Path', { segments: [[0, 0], [10, 10], [20, 0]], closed: true }] }
};

const resizeProject = (() => {
  const project = U.createProjectWithPermission(SHORTNAME, {});
  project.owner = H.annotator.username;
  project.collaborators.list[0].access = { collaborators: 'none', annotations: 'view', files: 'view' };
  project.files.list = [
    { source: MISSING, name: 'beta' },
    { source: CAT, name: 'alpha' }
  ];
  project.annotations.list = [
    { type: 'vectorial', name: 'Regions', values: 'Set B', display: true },
    { type: 'text', name: 'Notes', values: null, display: true }
  ];

  return project;
})();

// two projects on the user page of OWNER
const userProjects = ['b', 'a'].map((suffix) => {
  const p = U.createProjectWithPermission(`${SHORTNAME}${suffix}`, { files: 'view' });
  p.name = `Project ${suffix}`;
  p.owner = OWNER;
  p.collaborators.list[0].access.files = 'view';

  return p;
});

// the open file is one that exists: a missing one makes the viewer throw
const projectURL = () => U.url(`/project/${SHORTNAME}?source=${encodeURIComponent(CAT)}&project=${SHORTNAME}`);

// In the page: the header cells of a table's first row
const headerState = (page, table) => page.$eval(table, (t) => {
  const ths = [...t.tHead.rows[0].cells];

  return ths.map((th) => ({
    text: th.textContent.trim(),
    width: th.getBoundingClientRect().width,
    handle: th.querySelector(':scope > .nwl-col-resize[role="separator"]') !== null,
    label: (th.querySelector(':scope > .nwl-col-resize') || { getAttribute: () => null }).getAttribute('aria-label'),
    sort: th.getAttribute('aria-sort')
  }));
});
const widths = async (page, table) => (await headerState(page, table)).map((h) => h.width);
const firstColumn = (page, table) => page.$$eval(`${table} tbody tr`, (trs) => trs.map((tr) => tr.cells[0].textContent.trim()));
const layout = (page, table) => page.$eval(table, (t) => ({
  fixed: t.style.tableLayout === 'fixed',
  resized: t.classList.contains('nwl-resized')
}));

// The widths with the helper's handles, classes and wrapper taken out, measured
// before its MutationObserver puts them back
const widthsWithoutHelper = (page, table) => page.$eval(table, (t) => {
  t.querySelectorAll('.nwl-col-resize').forEach((handle) => handle.remove());
  t.querySelectorAll('th.nwl-resizable').forEach((th) => th.classList.remove('nwl-resizable'));
  const wrap = t.parentElement;
  if (wrap.classList.contains('nwl-resize-wrap')) {
    wrap.replaceWith(t);
  }

  return [...t.tHead.rows[0].cells].map((th) => th.getBoundingClientRect().width);
});

const dragHandle = async (page, table, col, dx) => {
  const handle = await page.$(`${table} thead th:nth-child(${col}) > .nwl-col-resize`);
  const box = await handle.boundingBox();
  const x = box.x + (box.width / 2);
  const y = box.y + (box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (dx / 2), y, { steps: 2 });
  await page.mouse.move(x + dx, y, { steps: 2 });
  await page.mouse.up();
  await H.settleFrames(page);
};

const assertClose = (actual, expected, message) => {
  assert.closeTo(actual, expected, 0.5, message);
};

// The checks on one table of a page opened by `open`
// eslint-disable-next-line max-statements
const checkTable = (getPage, open, table) => {
  let before;

  it(`${table}: every column header has a handle`, async function () {
    const page = getPage();
    await open();
    const headers = await headerState(page, table);
    assert.isAtLeast(headers.length, 2);
    headers.forEach((h) => {
      assert.isTrue(h.handle, `no handle on "${h.text}"`);
      assert.equal(h.label, `Resize column ${h.text}`);
    });
    before = headers.map((h) => h.width);
  }).timeout(U.mediumTimeout);

  it(`${table}: a mouse drag widens that column only, and does not sort`, async function () {
    const page = getPage();
    const rows = await firstColumn(page, table);
    const sorts = (await headerState(page, table)).map((h) => h.sort);
    await dragHandle(page, table, 1, 60);
    const after = await widths(page, table);
    assertClose(after[0], Math.round(before[0]) + 60, 'the dragged column');
    after.slice(1).forEach((w, i) => assertClose(w, before[i + 1], `column ${i + 2}`));
    assert.deepEqual(await layout(page, table), { fixed: true, resized: true });
    assert.deepEqual(await firstColumn(page, table), rows, 'rows not sorted');
    assert.deepEqual((await headerState(page, table)).map((h) => h.sort), sorts, 'aria-sort unchanged');
  }).timeout(U.shortTimeout);

  it(`${table}: ArrowRight on a focused handle adds 10px`, async function () {
    const page = getPage();
    const start = await widths(page, table);
    await page.focus(`${table} thead th:nth-child(2) > .nwl-col-resize`);
    await page.keyboard.press('ArrowRight');
    await H.settleFrames(page);
    const after = await widths(page, table);
    assertClose(after[1], start[1] + 10, 'the focused column');
    assertClose(after[0], start[0], 'the first column');
  }).timeout(U.shortTimeout);

  it(`${table}: a reload gives the automatic layout`, async function () {
    const page = getPage();
    await open();
    assert.deepEqual(await layout(page, table), { fixed: false, resized: false });
    (await widths(page, table)).forEach((w, i) => assertClose(w, before[i], `column ${i + 1}`));
  }).timeout(U.mediumTimeout);

  it(`${table}: before any drag, the columns are as wide as without the helper`, async function () {
    const page = getPage();
    const withHelper = await widths(page, table);
    const without = await widthsWithoutHelper(page, table);
    assert.lengthOf(without, withHelper.length);
    without.forEach((w, i) => assertClose(w, withHelper[i], `column ${i + 1}`));
  }).timeout(U.shortTimeout);
};

describe('Resizable columns (nwl-components 3.1.0)', function () {
  let context, page;
  let previousAdmins;
  const pageErrors = [];
  const getPage = () => page;

  // eslint-disable-next-line max-statements
  before(async function () {
    await U.insertProject([{ ...resizeProject }, ...userProjects.map((p) => ({ ...p }))]);
    await U.insertUser({ username: OWNER, name: OWNER, joined: new Date() });
    await U.removeAnnotations(ORPHAN_SOURCE);
    await U.insertAnnotations([orphan]);
    previousAdmins = admins.getAdmins();
    admins.setAdmins([H.annotator.username]);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await H.logIn(page);
  });

  after(async function () {
    admins.setAdmins(previousAdmins);
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all([
        U.removeProject(SHORTNAME),
        ...userProjects.map((p) => U.removeProject(p.shortname)),
        U.removeLocalUser(OWNER),
        U.removeAnnotations(ORPHAN_SOURCE)
      ]);
    }
  });

  afterEach(function () {
    assert.deepEqual(pageErrors.splice(0), [], 'no page errors');
  });

  describe('project page', function () {
    const open = async () => {
      await page.goto(projectURL(), { waitUntil: 'load' });
      await page.waitForSelector('#vecAnnotations .nwl-col-resize', { timeout: U.shortTimeout });
      await H.settleFrames(page);
    };
    checkTable(getPage, open, '#projectFiles table');
    checkTable(getPage, open, '#vecAnnotations');
  });

  describe('user page (Table.vue)', function () {
    const open = async () => {
      await page.goto(U.url(`/user/${OWNER}`), { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelectorAll('#projects tbody tr').length === 2
        && document.querySelector('#projects .nwl-col-resize') !== null, { timeout: U.shortTimeout });
      await H.settleFrames(page);
    };
    checkTable(getPage, open, '#projects');
  });

  it('settings and admin pages: every column header has a handle', async function () {
    const missing = () => page.$$eval('table', (tables) => tables
      .filter((t) => t.tHead && t.tHead.rows.length > 0)
      .flatMap((t) => [...t.tHead.rows[0].cells])
      .filter((th) => th.querySelector(':scope > .nwl-col-resize') === null)
      .map((th) => th.textContent.trim()));
    const count = () => page.$$eval('table thead th', (ths) => ths.length);

    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('table thead th .nwl-col-resize', { timeout: U.shortTimeout });
    assert.isAtLeast(await count(), 2, 'settings: headers');
    assert.deepEqual(await missing(), [], 'settings: headers without a handle');

    await page.goto(U.url(`/admin?source=${encodeURIComponent(ORPHAN_SOURCE)}`), { waitUntil: 'load' });
    await page.waitForSelector('#orphan-list thead th .nwl-col-resize', { timeout: U.shortTimeout });
    assert.isAtLeast(await count(), 2, 'admin: headers');
    assert.deepEqual(await missing(), [], 'admin: headers without a handle');
  }).timeout(U.mediumTimeout);
});
