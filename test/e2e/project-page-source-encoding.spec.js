'use strict';

/*
  N3: the project page's links to its files carry the file's source in the
  query string, encoded with encodeURIComponent. Before, a source holding `&`
  or `#` was cut there: `?source=/a&b#c.json&project=p` gives the source `/a`,
  a parameter `b`, and the fragment `#c.json&project=p` (no project). The
  viewer reads the source back decoded (Microdraw.deparam).
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const ODD = '/test_data/n3 a&b=c#d.json';
const CAT = '/test_data/cat.json';

const project = U.createProjectWithPermission('e2eprojectpagesource', {});
project.collaborators.list[0].access.files = 'view';
project.collaborators.list[0].access.annotations = 'view';
project.files.list = [
  { source: ODD, name: 'odd' },
  { source: CAT, name: 'cat' }
];

const projectURL = (source) => U.url(`/project/${project.shortname}${source ? `?source=${encodeURIComponent(source)}&project=${project.shortname}` : ''}`);
const selectedRows = (page) => page.evaluate(() => [...document.querySelectorAll('#projectFiles tbody tr')]
  .map((tr, i) => (tr.classList.contains('selected') ? i : -1)).filter((i) => i >= 0));

/**
 * Run `action` and return the URL of the next top-level navigation, answered
 * with 204 No Content: the browser stays on the page.
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

describe('Project page: file sources in the URL are encoded (N3)', function () {
  let context, page;

  before(async function () {
    await U.insertProject({ ...project });
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async function () {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  it('clicking a file whose source holds & and # opens it with the whole source and the project', async function () {
    await page.goto(projectURL(CAT), { waitUntil: 'load' });
    const target = await nextNavigation(page, () => page.click('#projectFiles tbody tr:nth-child(1) td:nth-child(1)'));
    assert.equal(target.searchParams.get('source'), ODD);
    assert.equal(target.searchParams.get('project'), project.shortname);
    assert.equal(target.hash, '');
    assert.equal(target.search, `?source=${encodeURIComponent(ODD)}&project=${project.shortname}`);
  }).timeout(U.mediumTimeout);

  it('without a source, opens the first file encoded; the row is selected and the viewer gets the source decoded', async function () {
    await page.goto(projectURL(), { waitUntil: 'load' });
    await page.waitForFunction(() => new URLSearchParams(location.search).get('source') !== null, { timeout: U.shortTimeout });
    const url = new URL(page.url());
    assert.deepEqual([url.searchParams.get('source'), url.searchParams.get('project'), url.hash], [ODD, project.shortname, '']);
    await page.waitForSelector('#projectFiles tbody tr.selected', { timeout: U.shortTimeout });
    assert.deepEqual(await selectedRows(page), [0]);
    // the viewer (Microdraw.deparam) reads the source and project from the URL
    await page.waitForFunction(() => window.Microdraw && window.Microdraw.params, { timeout: U.mediumTimeout });
    const viewer = await page.evaluate(() => ({ source: window.Microdraw.params.source, project: window.Microdraw.params.project }));
    assert.deepEqual(viewer, { source: ODD, project: project.shortname });
  }).timeout(U.mediumTimeout);
});
