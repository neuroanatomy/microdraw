'use strict';

const chai = require('chai');
var {assert, expect} = chai;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const U = require('../mocha.test.util');
const _ = require('lodash');
const H = require('./helpers');

/*
  Browser checks of the project settings page. The HTTP permission tests are
  in test/api/permissions.spec.js (moved there on 2026-10-12, T0.5a).
*/
describe('TESTING PERMISSIONS (settings page)', function () {
  const projects = {};
  let cookies = [];
  let context, page;

  // eslint-disable-next-line max-statements
  before(async function () {
    const agent = chai.request.agent(U.getServer());
    // waits until the user is stored (M3: logging in at once was flaky)
    await U.signUp(U.testingCredentials);
    const res = await agent.post('/localLogin').redirects(0)
      .send(U.testingCredentials);
    expect(res).to.have.cookie('connect.sid');
    cookies = U.parseCookies(res.headers['set-cookie'][0]);

    projects.collaboratorsnonefilesedit = U.createProjectWithPermission('collaboratorsnonefilesedit', { files: 'edit', collaborators: 'none' });
    projects.fileseditannotationsnone = U.createProjectWithPermission('fileseditannotationsnone', { files: 'edit', annotations: 'none' });
    await Promise.all(Object.values(projects).map((project) => U.insertProject(project)));

    context = await H.newContext();
    page = await context.newPage();
    await page.setCookie(...cookies);
  });

  after(async function () {
    await context.close();
    await Promise.all(Object.keys(projects).map((shortname) => U.removeProject(shortname)));
    await U.removeLocalUser(U.testingCredentials.username);
  });

  it('Check that collaborators cannot see other collaborators if not permitted', async function () {
    const project = _.cloneDeep(projects.collaboratorsnonefilesedit);
    const response = await page.goto(U.serverURL + '/project/' + project.shortname + '/settings');
    assert.equal(response.status(), 200);
    await page.waitForSelector('#access tbody');
    const contributorsTableLength = (await page.$$('#access tbody tr')).length;
    assert.equal(contributorsTableLength, 1); // 'anyone' only
  }).timeout(U.shortTimeout);

  it('Check that collaborators cannot see other annotations if not permitted', async function () {
    const project = _.cloneDeep(projects.fileseditannotationsnone);
    const response = await page.goto(U.serverURL + '/project/' + project.shortname + '/settings');
    assert.equal(response.status(), 200);
    await page.waitForSelector('#annotations tbody');
    const annotationsTableLength = (await page.$$('#annotations tbody tr')).length;
    assert.equal(annotationsTableLength, 1); // placeholder
  }).timeout(U.shortTimeout);
});
