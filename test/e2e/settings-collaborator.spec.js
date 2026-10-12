'use strict';

/*
  M7: nwl-components 1.3.x writes a `userID` next to `username` when a
  collaborator is chosen in the settings page. A collaborator added through the
  page and saved must get exactly the access granted there (checked through
  the HTTP routes), and a user who is not a collaborator must not.
*/
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-m7c-owner', password: 'e2e-m7c-owner-password' };
const collab = { username: 'e2e-m7c-collab', password: 'e2e-m7c-collab-password' };
const outsider = { username: 'e2e-m7c-outsider', password: 'e2e-m7c-outsider-password' };
const SHORTNAME = 'e2em7collab';
const SOURCE = 'http://m7-collab.localhost/brain.dzi';

const privateProject = {
  name: 'M7 collaborator',
  shortname: SHORTNAME,
  url: '',
  created: '2026-10-12T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      {
        username: 'anyone',
        name: 'Any User',
        access: { collaborators: 'none', annotations: 'none', files: 'none' }
      }
    ]
  },
  files: { list: [{ source: SOURCE, name: 'brain' }] },
  annotations: { list: [] }
};

const tokenOf = async (user) => {
  const agent = await U.logIn(user);
  const { token } = (await agent.get('/token')).body;
  assert.isNotEmpty(token);

  return token;
};

const viewProject = (token) => chai.request(U.serverURL)
  .get(`/project/json/${SHORTNAME}`)
  .query({ token });

const uploadRegion = (token) => chai.request(U.serverURL)
  .post('/api/upload')
  .query({ action: 'save', source: SOURCE, slice: 0, project: SHORTNAME, token })
  .attach('data', Buffer.from(JSON.stringify([
    {
      annotation: { name: 'm7c', path: ['Path', { segments: [[10, 20], [30, 40], [50, 20]], closed: true }] }
    }
  ])), 'annotation.json');

describe('Collaborator added in the settings page (M7)', () => {
  const tokens = {};
  let context;
  let page;

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(privateProject);
    tokens.collab = await tokenOf(collab);
    tokens.outsider = await tokenOf(outsider);
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
  });

  after(async () => {
    await context.close();
    await U.removeProject(SHORTNAME);
    await U.removeAnnotations(SOURCE);
    await Promise.all([owner, collab, outsider].map((u) => U.removeLocalUser(u.username)));
  });

  it('before: neither user may view the private project', async () => {
    assert.equal((await viewProject(tokens.collab)).status, 403);
    assert.equal((await viewProject(tokens.outsider)).status, 403);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('adds the collaborator (files: view, annotations: edit) and saves', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('#access tbody tr', { timeout: U.shortTimeout });
    await page.click('button[title="Add collaborator"]');
    await page.waitForFunction(() => document.querySelectorAll('#access tbody tr').length === 2, { polling: 50, timeout: U.shortTimeout });

    const row = '#access tbody tr:nth-child(2)';
    await page.type(`${row} input[role="searchbox"]`, collab.username);
    const result = await page.waitForFunction(
      (r, name) => [...document.querySelectorAll(`${r} li.autocomplete-result`)]
        .find((li) => li.textContent.trim() === name),
      { polling: 50, timeout: U.shortTimeout },
      row,
      collab.username
    );
    await result.asElement().click();
    // columns: user name, name, collaborators, annotations, files
    await page.click(`${row} td:nth-child(4) button.edit`);
    await page.click(`${row} td:nth-child(5) button.view`);

    const [save] = await page.$x('//button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    await page.waitForFunction(
      () => document.querySelector('#saveFeedback').textContent.trim() !== '',
      { polling: 50, timeout: U.shortTimeout }
    );

    const saved = (await U.queryProject(SHORTNAME)).collaborators.list
      .find((c) => c.username === collab.username);
    assert.isOk(saved, 'the collaborator was not saved');
    assert.equal(saved.userID, collab.username);
    assert.deepEqual(saved.access, { collaborators: 'none', annotations: 'edit', files: 'view' });
  }).timeout(U.mediumTimeout);

  it('after: the collaborator may view the project and save annotations, the outsider may not', async () => {
    assert.equal((await viewProject(tokens.collab)).status, 200);
    assert.equal((await uploadRegion(tokens.collab)).status, 200);
    assert.equal((await viewProject(tokens.outsider)).status, 403);
    assert.equal((await uploadRegion(tokens.outsider)).status, 403);
  }).timeout(U.shortTimeout);
});
