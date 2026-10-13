'use strict';

/*
  M4d: no page loads jQuery any more: window.jQuery is undefined and nothing
  named like jquery is requested, on the viewer, project, landing, user,
  project settings, new project and admin pages.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const user = { username: 'e2e-m4d-user', password: 'e2e-m4d-user-password' };
const project = U.createPublicAnnotationProject('e2em4dpages');
project.owner = user.username;

// eslint-disable-next-line max-statements
describe('No page loads jQuery (M4d)', () => {
  let context;
  let page;
  let previousAdmins;
  const jqueryRequests = [];
  const pageErrors = [];

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([user.username]);
    await U.insertProject(project);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('request', (req) => {
      if ((/jquery/i).test(req.url())) { jqueryRequests.push(req.url()); }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await H.logIn(page, user);
  });

  beforeEach(() => {
    jqueryRequests.length = 0;
    pageErrors.length = 0;
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  // `errors` filters the page errors to check (default: all of them)
  const noJQuery = async (errors = () => true) => {
    const globals = await page.evaluate(() => [typeof window.jQuery, typeof window.$]);
    assert.deepEqual(globals, ['undefined', 'undefined'], 'window.jQuery / window.$');
    assert.deepEqual(jqueryRequests, [], 'requests for jQuery');
    assert.deepEqual(pageErrors.filter(errors), [], 'page errors');
  };

  it('viewer page', async () => {
    await H.openData(page, U.url('/data?source=/test_data/cat.json&slice=0'));
    await page.waitForFunction(() => window.MUI && window.Microdraw.tools.layers, { timeout: U.shortTimeout });
    await noJQuery();
  }).timeout(U.mediumTimeout);

  it('project page, with the viewer scripts', async () => {
    await page.goto(U.url(`/project/${project.shortname}`), { waitUntil: 'load' });
    // the viewer's scripts (microdraw.js, mui.js, the tools) are loaded
    await page.waitForFunction(() => window.Microdraw && window.MUI && window.Microdraw.tools && window.Microdraw.tools.layers, { timeout: U.mediumTimeout });
    await H.settleFrames(page);
    // Offline, the project page's Vue 2 (still from a CDN, M8) does not load:
    // "Vue is not defined", and the viewer gets no source. Not jQuery's errors.
    await noJQuery((message) => (/\$|jQuery|MUI|mui/).test(message));
  }).timeout(U.longTimeout);

  [
    ['landing page', () => '/', '#url'],
    ['user page', () => `/user/${user.username}`, '#content, #app, body'],
    ['project settings page', () => `/project/${project.shortname}/settings`, 'body'],
    ['new project page', () => '/project/new', 'body'],
    ['admin page', () => '/admin', 'body']
  ].forEach(([name, path, selector]) => {
    it(name, async () => {
      const res = await page.goto(U.url(path()), { waitUntil: 'load' });
      assert.equal(res.status(), 200);
      await page.waitForSelector(selector, { timeout: U.shortTimeout });
      await H.settleFrames(page);
      await noJQuery();
    }).timeout(U.mediumTimeout);
  });
});
