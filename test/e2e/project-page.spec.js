/* eslint max-lines: ["error", 400] -- the project page's tables, navigation and escaping (M2, H2b, M3c, M8a; 2026-10-13) */
'use strict';

const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  The project page (/project/:name): its header, the files and annotation
  tables, moving between files (click, up/down keys), the resize handle, the
  empty states (M2b), user-set names written as text (H2b) and the annotation
  layers a visitor may not see left out of the page (M3c).

  M8a: the page was an inline Vue 2 app loaded from the jsdelivr CDN, which the
  offline e2e browser cannot reach, so this spec used to answer that URL with a
  stand-in (D24) and could not check the tables. The tests below describe the
  page as users see it, not how it is built: they were run against the Vue 2
  page (with a local copy of Vue 2.6.14 answering the CDN URL, outside the
  repo) and against the webpack-built Vue 3 page, unchanged.

  Moving to another file is a full navigation. Where only its URL matters,
  `nextNavigation` answers it with 204 No Content, so the page stays.
*/
const CAT = '/test_data/cat.json';
const ZARR = '/test_data/cat-zarr.json';
const MISSING = '/test_data/not-there.json';

const publicProject = (shortname) => {
  const project = U.createProjectWithPermission(shortname, {});
  project.collaborators.list[0].access.files = 'view';
  project.collaborators.list[0].access.annotations = 'view';

  return project;
};

const emptyProject = publicProject('e2eprojectpageempty');
emptyProject.files.list = [];
emptyProject.annotations.list = [];

const noAnnotationsProject = publicProject('e2eprojectpagenoannotations');
noAnnotationsProject.files.list = [{ source: CAT, name: 'cat' }];
noAnnotationsProject.annotations.list = [];

const fullProject = publicProject('e2eprojectpagefull');
fullProject.name = 'Full project page';
fullProject.files.list = [
  { source: CAT, name: 'cat' },
  { source: ZARR, name: 'cat-zarr' },
  { source: MISSING, name: '' }
];
fullProject.annotations.list = [
  { type: 'vectorial', name: 'regions', values: 'Set I', display: true },
  { type: 'text', name: 'comment', values: null, display: true },
  { type: 'vectorial', name: 'more regions', values: 'Set II', display: true }
];

// files visible to anyone, annotations to nobody but the collaborators (M3c)
const hiddenLayersProject = publicProject('e2eprojectpagehiddenlayers');
hiddenLayersProject.collaborators.list[0].access.annotations = 'none';
hiddenLayersProject.files.list = [{ source: CAT, name: 'cat' }];
hiddenLayersProject.annotations.list = [{ type: 'vectorial', name: 'secret-layer-name', values: 'secret-label-set', display: true }];

const projects = [emptyProject, noAnnotationsProject, fullProject, hiddenLayersProject];
const projectURL = (p, source) => U.url(`/project/${p.shortname}${source ? `?source=${source}&project=${p.shortname}` : ''}`);

const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);

  return Boolean(el) && !el.hidden && el.getBoundingClientRect().height > 0;
}, sel);

// The text a table shows, row by row. A cell is an input (Vue 2 page) or text.
const tableText = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} tbody tr`)].map((tr) => [...tr.cells].map((td) => {
  const input = td.querySelector('input');

  return input ? input.value : td.textContent.trim();
})), sel);
const headerText = (page) => page.evaluate(() => [...document.querySelectorAll('#projectFiles thead th')].map((th) => th.textContent));
const selectedRows = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} tbody tr`)]
  .map((tr, i) => (tr.classList.contains('selected') ? i : -1)).filter((i) => i >= 0), sel);

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

// Open a project page. The viewer is not waited for here (project-page-viewer.spec.js does).
const openPage = async (page, pageUrl) => {
  await page.goto(pageUrl, { waitUntil: 'load' });
  await H.settleFrames(page);
};

// eslint-disable-next-line max-statements
describe('Project page (M2b, M8a)', function () {
  let context, page;
  const pageErrors = [];

  before(async function () {
    await Promise.all(projects.map((p) => U.insertProject({ ...p })));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  beforeEach(function () {
    pageErrors.length = 0;
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all(projects.map((p) => U.removeProject(p.shortname)));
    }
  });

  // eslint-disable-next-line max-statements
  it('a project with no files shows an empty state, without errors or redirect', async function () {
    const pageUrl = projectURL(emptyProject);
    await openPage(page, pageUrl);
    assert.deepEqual(pageErrors, []);
    assert.equal(page.url(), pageUrl, 'the page redirected');
    assert.isTrue(await visible(page, '#noFiles'), 'no "no files" message');
    assert.isTrue(await visible(page, '#noAnnotations'), 'no "no annotations" message');
    assert.deepEqual(await tableText(page, '#projectFiles'), []);
    assert.deepEqual(await tableText(page, '#vecAnnotations'), []);
    assert.isFalse(await page.evaluate(() => Boolean(document.querySelector('#microdraw').shadowRoot)), 'the viewer was attached');
    const settingsLink = await page.$eval('#noFiles a', (a) => a.getAttribute('href'));
    assert.equal(settingsLink, `/project/${emptyProject.shortname}/settings`);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements
  it('a project with files and no annotations opens its first file, without errors', async function () {
    await page.goto(projectURL(noAnnotationsProject), { waitUntil: 'load' });
    await page.waitForFunction(() => new URLSearchParams(location.search).get('source') !== null, { timeout: U.shortTimeout });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: U.shortTimeout });
    await H.settleFrames(page);
    assert.deepEqual(pageErrors, []);
    const params = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
    assert.equal(params.source, CAT);
    assert.equal(params.project, noAnnotationsProject.shortname);
    assert.isFalse(await visible(page, '#noFiles'), '"no files" message shown');
    assert.isTrue(await visible(page, '#noAnnotations'), 'no "no annotations" message');
    assert.deepEqual(await tableText(page, '#projectFiles'), [['cat', CAT]]);
  }).timeout(U.mediumTimeout);

  it('shows the project name, its files and its annotation layers', async function () {
    await openPage(page, projectURL(fullProject, ZARR));
    assert.deepEqual(pageErrors, []);
    assert.equal(await page.$eval('#fontLogo a', (a) => a.textContent.trim()), fullProject.name);
    // text annotations get a column in the files table (its cells stay empty)
    assert.deepEqual(await headerText(page), ['Name', 'File', 'comment']);
    assert.deepEqual(await tableText(page, '#projectFiles'), [['cat', CAT], ['cat-zarr', ZARR], ['', MISSING]]);
    assert.deepEqual(await tableText(page, '#vecAnnotations'), [['regions', 'Set I'], ['comment', ''], ['more regions', 'Set II']]);
    assert.isFalse(await visible(page, '#noFiles'));
    assert.isFalse(await visible(page, '#noAnnotations'));
  }).timeout(U.shortTimeout);

  it('selects the row of the file in the URL and the first annotation layer', async function () {
    await openPage(page, projectURL(fullProject, ZARR));
    assert.deepEqual(await selectedRows(page, '#projectFiles'), [1]);
    assert.deepEqual(await selectedRows(page, '#vecAnnotations'), [0]);
    // a source that is not in the project selects the first row
    await openPage(page, projectURL(fullProject, '/test_data/other.json'));
    assert.deepEqual(await selectedRows(page, '#projectFiles'), [0]);
  }).timeout(U.mediumTimeout);

  it('clicking another file opens it in the project; clicking the open one does nothing', async function () {
    await openPage(page, projectURL(fullProject, CAT));
    const target = await nextNavigation(page, async () => {
      // the open file first: no navigation; then the next one
      await page.click('#projectFiles tbody tr:nth-child(1) td:nth-child(2)');
      await page.click('#projectFiles tbody tr:nth-child(2) td:nth-child(1)');
    });
    assert.equal(target.pathname, `/project/${fullProject.shortname}`);
    // the source is encoded since N3 (project-page-source-encoding.spec.js)
    assert.equal(target.search, `?source=${encodeURIComponent(ZARR)}&project=${fullProject.shortname}`);
  }).timeout(U.mediumTimeout);

  it('the up and down keys open the previous and next file, wrapping around', async function () {
    await openPage(page, projectURL(fullProject, ZARR));
    const down = await nextNavigation(page, () => page.keyboard.press('ArrowDown'));
    assert.equal(down.searchParams.get('source'), MISSING);
    const up = await nextNavigation(page, () => page.keyboard.press('ArrowUp'));
    assert.equal(up.searchParams.get('source'), CAT);
    await openPage(page, projectURL(fullProject, CAT));
    const wrapped = await nextNavigation(page, () => page.keyboard.press('ArrowUp'));
    assert.equal(wrapped.searchParams.get('source'), MISSING);
    assert.equal(wrapped.searchParams.get('project'), fullProject.shortname);
  }).timeout(U.mediumTimeout);

  it('clicking an annotation layer selects it', async function () {
    await openPage(page, projectURL(fullProject, CAT));
    await page.click('#vecAnnotations tbody tr:nth-child(3) td:nth-child(1)');
    assert.deepEqual(await selectedRows(page, '#vecAnnotations'), [2]);
    await page.click('#vecAnnotations tbody tr:nth-child(2) td:nth-child(2)');
    assert.deepEqual(await selectedRows(page, '#vecAnnotations'), [1]);
    assert.deepEqual(await selectedRows(page, '#projectFiles'), [0], 'the file selection changed');
  }).timeout(U.shortTimeout);

  it('the resize handle changes the width of the tables', async function () {
    await openPage(page, projectURL(fullProject, CAT));
    const widthOf = () => page.$eval('#left', (el) => el.getBoundingClientRect().width);
    const before = await widthOf();
    const handle = await page.$eval('#resizeButton', (el) => {
      const r = el.getBoundingClientRect();

      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 60, handle.y, { steps: 6 });
    await page.mouse.up();
    // the first move only records where the drag starts (10 px of 60 here)
    assert.closeTo(await widthOf() - before, 50, 2);
  }).timeout(U.shortTimeout);

  it('the menu buttons open a new project and the project settings', async function () {
    await openPage(page, projectURL(fullProject, CAT));
    const add = await nextNavigation(page, () => page.click('#addProject'));
    assert.equal(add.pathname, '/project/new');
    const settings = await nextNavigation(page, () => page.click('#settings'));
    assert.equal(settings.pathname, `/project/${fullProject.shortname}/settings`);
  }).timeout(U.shortTimeout);

  // M8a: the old page's inputs looked editable but were never saved
  it('shows read-only cells and loads no script from a CDN (M8a)', async function () {
    await openPage(page, projectURL(fullProject, CAT));
    const state = await page.evaluate(() => ({
      editable: document.querySelectorAll('#projectFiles tbody :is(input, textarea, select, [contenteditable]), #vecAnnotations tbody :is(input, textarea, select, [contenteditable])').length,
      scripts: [...document.scripts].map((s) => s.src).filter((src) => src && new URL(src).hostname !== location.hostname)
    }));
    assert.equal(state.editable, 0, 'a cell is editable');
    // analytics (umami, gtag in partials/header) are the only third-party scripts, as on the other pages
    assert.deepEqual(state.scripts.filter((src) => !(/\/umami\/|googletagmanager/).test(src)), []);
  }).timeout(U.shortTimeout);

  it('a visitor who may not see the annotations gets no layer in the page (M3c)', async function () {
    await openPage(page, projectURL(hiddenLayersProject, CAT));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await tableText(page, '#vecAnnotations'), []);
    assert.isTrue(await visible(page, '#noAnnotations'));
    const html = await page.content();
    assert.notInclude(html, 'secret-layer-name');
    assert.notInclude(html, 'secret-label-set');
  }).timeout(U.shortTimeout);
});

/*
  H2b: names set by a project's owner or collaborators are shown to visitors.
  They are written as text: not parsed as HTML, not run, not compiled as a
  template, and a name holding `</script>` does not end the page's inline
  script.
*/
// eslint-disable-next-line max-statements
describe('Project page writes user-set names as text (H2b)', function () {
  const IMG_NAME = '<img src=x onerror="window.h2bInjected=true">';
  const SCRIPT_NAME = '</script><script>window.h2bInjected=true</script>';
  const TEMPLATE_NAMES = ['{{ 7*7 }}', '[[ 7*7 ]]'];
  const injectionProject = publicProject('e2eprojectpageinjection');
  injectionProject.name = IMG_NAME;
  injectionProject.files.list = [
    { source: CAT, name: IMG_NAME },
    { source: MISSING, name: TEMPLATE_NAMES[0] }
  ];
  injectionProject.annotations.list = [
    { type: 'text', name: IMG_NAME, values: null, display: true },
    { type: 'text', name: SCRIPT_NAME, values: null, display: true },
    { type: 'vectorial', name: TEMPLATE_NAMES[1], values: SCRIPT_NAME, display: true }
  ];
  let context, page;
  const pageErrors = [];

  before(async function () {
    await U.insertProject({ ...injectionProject });
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(injectionProject.shortname);
    }
  });

  it('shows names as text, runs none of them, and keeps them intact', async function () {
    await openPage(page, projectURL(injectionProject, CAT));
    assert.deepEqual(pageErrors, []);
    const state = await page.evaluate(() => ({
      injected: typeof window.h2bInjected,
      images: document.querySelectorAll('img[src="x"]').length,
      title: document.querySelector('#fontLogo a').textContent.trim()
    }));
    assert.equal(state.injected, 'undefined', 'a name ran as code');
    assert.equal(state.images, 0, 'a name was parsed as HTML');
    assert.equal(state.title, IMG_NAME);
    assert.deepEqual(await headerText(page), ['Name', 'File', IMG_NAME, SCRIPT_NAME]);
    assert.deepEqual(await tableText(page, '#projectFiles'), [[IMG_NAME, CAT], [TEMPLATE_NAMES[0], MISSING]]);
    assert.deepEqual(await tableText(page, '#vecAnnotations'), [[IMG_NAME, ''], [SCRIPT_NAME, ''], [TEMPLATE_NAMES[1], SCRIPT_NAME]]);
  }).timeout(U.shortTimeout);
});
