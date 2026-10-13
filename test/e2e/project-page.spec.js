'use strict';

const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  M2: the project page (/project/:name) with no files or no annotations. It
  used to throw in its inline script (files.list[0].source, rows that do not
  exist), so nothing after the error ran. It now shows an empty state.

  The page loads Vue 2 from the jsdelivr CDN (M8 replaces it); the e2e browser
  is offline. The CDN script is answered with a stand-in that only keeps
  `data`, which the page reads back as `app.projectInfo`. Vue's own rendering
  (the v-for rows) is therefore not exercised here: the checks are on the
  page's script and on the empty-state elements, which do not depend on Vue.
*/
const VUE_CDN = 'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.min.js';
const VUE_STAND_IN = 'window.Vue = function (options) { Object.assign(this, options.data); };';
const SOURCE = '/test_data/cat.json';

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
noAnnotationsProject.files.list = [{ source: SOURCE, name: 'cat' }];
noAnnotationsProject.annotations.list = [];

const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);

  return Boolean(el) && !el.hidden && el.getBoundingClientRect().height > 0;
}, sel);

describe('Project page empty states (M2)', function () {
  let context, page;
  const pageErrors = [];

  before(async function () {
    await Promise.all([emptyProject, noAnnotationsProject].map((p) => U.insertProject({ ...p })));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url() === VUE_CDN) {
        req.respond({ status: 200, contentType: 'application/javascript', body: VUE_STAND_IN });
      } else {
        req.continue();
      }
    });
  });

  beforeEach(function () {
    pageErrors.length = 0;
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all([emptyProject, noAnnotationsProject].map((p) => U.removeProject(p.shortname)));
    }
  });

  it('a project with no files shows an empty state, without errors or redirect', async function () {
    const pageUrl = U.url(`/project/${emptyProject.shortname}`);
    await page.goto(pageUrl, { waitUntil: 'load' });
    await H.settleFrames(page);
    assert.deepEqual(pageErrors, []);
    assert.equal(page.url(), pageUrl, 'the page redirected');
    assert.isTrue(await visible(page, '#noFiles'), 'no "no files" message');
    assert.isTrue(await visible(page, '#noAnnotations'), 'no "no annotations" message');
    assert.isFalse(await page.evaluate(() => Boolean(document.querySelector('#microdraw').shadowRoot)), 'the viewer was attached');
    const settingsLink = await page.$eval('#noFiles a', (a) => a.getAttribute('href'));
    assert.equal(settingsLink, `/project/${emptyProject.shortname}/settings`);
  }).timeout(U.shortTimeout);

  it('a project with files and no annotations opens its first file, without errors', async function () {
    await page.goto(U.url(`/project/${noAnnotationsProject.shortname}`), { waitUntil: 'load' });
    await page.waitForFunction(() => new URLSearchParams(location.search).get('source') !== null, { timeout: U.shortTimeout });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: U.shortTimeout });
    await H.settleFrames(page);
    assert.deepEqual(pageErrors, []);
    const params = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
    assert.equal(params.source, SOURCE);
    assert.equal(params.project, noAnnotationsProject.shortname);
    assert.isFalse(await visible(page, '#noFiles'), '"no files" message shown');
    assert.isTrue(await visible(page, '#noAnnotations'), 'no "no annotations" message');
  }).timeout(U.mediumTimeout);
});

/*
  H2b: names set by a project's owner or collaborators are shown to visitors.
  A text-annotation name is written into the files table header as text, and
  a name holding `</script>` does not end the page's inline script.
*/
describe('Project page writes user-set names as text (H2b)', function () {
  const IMG_NAME = '<img src=x onerror="window.h2bInjected=true">';
  const SCRIPT_NAME = '</script><script>window.h2bInjected=true</script>';
  const injectionProject = publicProject('e2eprojectpageinjection');
  injectionProject.files.list = [];
  injectionProject.annotations.list = [
    { type: 'text', name: IMG_NAME, values: null, display: true },
    { type: 'text', name: SCRIPT_NAME, values: null, display: true }
  ];
  let context, page;
  const pageErrors = [];

  before(async function () {
    await U.insertProject({ ...injectionProject });
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url() === VUE_CDN) {
        req.respond({ status: 200, contentType: 'application/javascript', body: VUE_STAND_IN });
      } else {
        req.continue();
      }
    });
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(injectionProject.shortname);
    }
  });

  it('shows annotation names as text, runs none of them, and keeps them intact', async function () {
    await page.goto(U.url(`/project/${injectionProject.shortname}`), { waitUntil: 'load' });
    await H.settleFrames(page);
    assert.deepEqual(pageErrors, []);
    const state = await page.evaluate(() => ({
      injected: typeof window.h2bInjected,
      headers: [...document.querySelectorAll('#projectFiles thead th')].map((th) => th.textContent),
      images: document.querySelectorAll('#projectFiles img, #app img[src="x"]').length,
      // eslint-disable-next-line no-undef -- the page's global Vue app
      names: app.projectInfo.annotations.list.map((a) => a.name)
    }));
    assert.equal(state.injected, 'undefined', 'an annotation name ran as code');
    assert.equal(state.images, 0, 'an annotation name was parsed as HTML');
    assert.deepEqual(state.headers, ['Name', 'File', IMG_NAME, SCRIPT_NAME]);
    assert.deepEqual(state.names, [IMG_NAME, SCRIPT_NAME]);
  }).timeout(U.shortTimeout);
});
