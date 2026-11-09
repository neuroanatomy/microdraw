'use strict';

const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  Text layers step 3 (2026-11-09): the project page's files table shows, under
  each named text layer, each file's current value, read only, fetched from
  GET /project/json/<shortname>/text-annotations after the page is mounted.
  The values are inserted directly in `textAnnotations` (as in
  test/api/text-annotations.spec.js); editing is step 4.
*/
const CAT = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const MISSING = '/test_data/not-there.json';
const IMG_VALUE = '<img src=x onerror="window.tl3Injected=true">';
const ROUTE = '/text-annotations';

const publicProject = (shortname, annotations = 'view') => {
  const project = U.createProjectWithPermission(shortname, {});
  project.collaborators.list[0].access.files = 'view';
  project.collaborators.list[0].access.annotations = annotations;
  project.files.list = [
    { source: CAT, name: 'cat' },
    { source: ZARR, name: 'cat-zarr' },
    { source: MISSING, name: 'missing' }
  ];
  project.annotations.list = [
    { type: 'text', name: 'Notes', values: null, display: true },
    { type: 'vectorial', name: 'Regions', values: 'Set I', display: true },
    { type: 'text', name: 'Progress', values: null, display: true }
  ];

  return project;
};

const valuesProject = publicProject('e2etextlayersvalues');
const failingProject = publicProject('e2etextlayersfailing');
// files visible to anyone, annotations to nobody but the collaborators (M3c)
const hiddenProject = publicProject('e2etextlayershidden', 'none');
const projects = [valuesProject, failingProject, hiddenProject];
const shortnames = projects.map((p) => p.shortname);

const doc = (project, source, layer, value, extra = {}) => ({
  project: project.shortname,
  source,
  layer,
  value,
  user: 'e2e-text-layers',
  modified: new Date('2026-11-09T10:00:00Z'),
  ...extra
});

// inserted one by one, so that _id order is insertion order
const docs = [
  doc(valuesProject, CAT, 'Notes', 'old note', { backup: true }),
  doc(valuesProject, CAT, 'Notes', 'current note'),
  doc(valuesProject, ZARR, 'Progress', 'half done'),
  doc(valuesProject, MISSING, 'Notes', IMG_VALUE),
  doc(failingProject, CAT, 'Notes', 'not shown'),
  doc(hiddenProject, CAT, 'Notes', 'secret-text-value')
];

const projectURL = (p, source) => U.url(`/project/${p.shortname}?source=${encodeURIComponent(source)}&project=${p.shortname}`);

// Cells as text, with whether they have the `empty` class and their title
const cells = (page) => page.evaluate(() => [...document.querySelectorAll('#projectFiles tbody tr')]
  .map((tr) => [...tr.cells].map((td) => ({
    text: td.textContent,
    empty: td.classList.contains('empty'),
    title: td.getAttribute('title')
  }))));
const rowText = async (page) => (await cells(page)).map((row) => row.map((c) => c.text.trim()));
const headerText = (page) => page.evaluate(() => [...document.querySelectorAll('#projectFiles thead th')].map((th) => th.textContent));

// eslint-disable-next-line max-statements
describe('Project page shows the values of text layers (text layers step 3)', function () {
  let context, page;
  const pageErrors = [];
  const warnings = [];
  // URLs of the requests to the text-annotations route, and of failed responses
  const routeRequests = [];
  const failedResponses = [];

  before(async function () {
    await Promise.all(projects.map((p) => U.insertProject({ ...p })));
    for (const d of docs) {
      // eslint-disable-next-line no-await-in-loop -- one by one: _id order matters
      await U.getDB().collection('textAnnotations')
        .insertOne({ ...d });
    }
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'warn') { warnings.push(msg.text()); } });
    page.on('request', (req) => { if (req.url().includes(ROUTE)) { routeRequests.push(req.url()); } });
    page.on('response', (res) => { if (res.status() >= 400) { failedResponses.push(`${res.status()} ${res.url()}`); } });
  });

  beforeEach(function () {
    pageErrors.length = 0;
    warnings.length = 0;
    routeRequests.length = 0;
    failedResponses.length = 0;
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all([
        ...shortnames.map((s) => U.removeProject(s)),
        U.getDB().collection('textAnnotations')
          .deleteMany({ project: { $in: shortnames } })
      ]);
    }
  });

  // Open a page and wait until the text-annotations route has answered and
  // the page has rendered what it got
  const openAndWaitForValues = async (pageUrl) => {
    const answered = page.waitForResponse((res) => res.url().includes(ROUTE), { timeout: U.shortTimeout });
    await page.goto(pageUrl, { waitUntil: 'load' });
    await answered;
    await H.settleFrames(page);
  };

  // eslint-disable-next-line max-statements
  it('shows the newest current value under its layer and file, and empty cells elsewhere', async function () {
    await openAndWaitForValues(projectURL(valuesProject, ZARR));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(routeRequests, [U.url(`/project/json/${valuesProject.shortname}${ROUTE}`)]);
    assert.deepEqual(await headerText(page), ['Name', 'File', 'Notes', 'Progress']);
    assert.deepEqual(await rowText(page), [
      ['cat', CAT, 'current note', ''],
      ['cat-zarr', ZARR, '', 'half done'],
      ['missing', MISSING, IMG_VALUE, '']
    ]);
    const table = await cells(page);
    // a file without a value: an empty cell, with the `empty` class and no title
    assert.deepEqual(table[0][3], { text: '', empty: true, title: null });
    assert.deepEqual(table[1][2], { text: '', empty: true, title: null });
    // a value: its full text in the title
    assert.deepEqual(table[0][2], { text: 'current note', empty: false, title: 'current note' });
    assert.deepEqual(table[1][3], { text: 'half done', empty: false, title: 'half done' });
    // the backup is not shown anywhere
    assert.notInclude(await page.$eval('#projectFiles', (el) => el.textContent), 'old note');
  }).timeout(U.mediumTimeout);

  it('shows a value holding HTML as text, and runs none of it (as H2b)', async function () {
    await openAndWaitForValues(projectURL(valuesProject, CAT));
    assert.deepEqual(pageErrors, []);
    const state = await page.evaluate(() => ({
      injected: typeof window.tl3Injected,
      images: document.querySelectorAll('img[src="x"]').length,
      cell: document.querySelector('#projectFiles tbody tr:nth-child(3) td:nth-child(3)').textContent
    }));
    assert.equal(state.injected, 'undefined', 'a value ran as code');
    assert.equal(state.images, 0, 'a value was parsed as HTML');
    assert.equal(state.cell, IMG_VALUE);
  }).timeout(U.mediumTimeout);

  it('every row has as many cells as the header', async function () {
    await openAndWaitForValues(projectURL(valuesProject, CAT));
    const headers = (await headerText(page)).length;
    const rows = await cells(page);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.length), [headers, headers, headers]);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements
  it('when the route answers 500, the page loads with empty cells, a warning and no error', async function () {
    const onRequest = (req) => {
      if (req.isInterceptResolutionHandled()) { return; }
      if (req.url().includes(ROUTE)) {
        req.respond({ status: 500, contentType: 'application/json', body: '{"error":"test"}' });
      } else {
        req.continue();
      }
    };
    await page.setRequestInterception(true);
    page.on('request', onRequest);
    try {
      await openAndWaitForValues(projectURL(failingProject, CAT));
    } finally {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(routeRequests.length, 1);
    assert.deepEqual(await headerText(page), ['Name', 'File', 'Notes', 'Progress']);
    assert.deepEqual(await rowText(page), [
      ['cat', CAT, '', ''],
      ['cat-zarr', ZARR, '', ''],
      ['missing', MISSING, '', '']
    ]);
    assert.isTrue((await cells(page)).every((row) => row.slice(2).every((c) => c.empty)), 'a text cell is not marked empty');
    assert.isTrue(warnings.some((w) => w.includes('text layers')), `no warning: ${JSON.stringify(warnings)}`);
  }).timeout(U.mediumTimeout);

  // Last: on this project the viewer's own load of the annotations answers 403,
  // and microdraw.js reports it as an unhandled 'Forbidden' a moment after the
  // page loads (as before step 3; project-page.spec.js's M3c test does not wait
  // long enough to see it). Run earlier, it lands in the next test's pageErrors.
  it('a visitor who may not see the layers gets no text column and no failing request (M3c)', async function () {
    await page.goto(projectURL(hiddenProject, CAT), { waitUntil: 'load' });
    await H.settleFrames(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await headerText(page), ['Name', 'File']);
    assert.deepEqual(await rowText(page), [['cat', CAT], ['cat-zarr', ZARR], ['missing', MISSING]]);
    assert.deepEqual(routeRequests, [], 'the page fetched the values');
    // the viewer asks for the missing file (404): only text-annotations matters here
    assert.deepEqual(failedResponses.filter((r) => r.includes(ROUTE)), []);
    assert.notInclude(await page.content(), 'secret-text-value');
  }).timeout(U.mediumTimeout);
});
