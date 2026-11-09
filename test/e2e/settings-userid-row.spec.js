'use strict';

/*
  T002 2.2: a stored collaborator row may name its user by `userID` only
  (BrainBox's key). The real nwl-components settings page must show it, with
  its access, and a save from the page unchanged must store the row with
  `username` and `userID`, equal, keeping its access.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-t0022-owner', password: 'e2e-t0022-owner-password' };
const collab = { username: 'e2e-t0022-collab', name: 'T002 Collab' };
const SHORTNAME = 'e2et0022userid';
const access = { collaborators: 'view', annotations: 'edit', files: 'view' };

const storedProject = () => ({
  name: 'T002 2.2 userID row',
  shortname: SHORTNAME,
  url: '',
  created: '2026-11-09T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      { username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'none', files: 'view' } },
      { userID: collab.username, access }
    ]
  },
  files: { list: [{ source: 'http://t0022.localhost/brain.dzi', name: 'brain' }] },
  annotations: { list: [] }
});

describe('Settings page with a collaborator row named by userID only (T002 2.2)', () => {
  let context;
  let page;

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.removeLocalUser(collab.username);
    await U.insertUser({ ...collab });
    await U.insertProject(storedProject());
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
  });

  after(async () => {
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(SHORTNAME);
      await U.removeLocalUser(owner.username);
      await U.removeLocalUser(collab.username);
    }
  });

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('shows the row and saves it with both keys', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('#access tbody tr', { timeout: U.shortTimeout });
    await page.waitForFunction(() => document.querySelectorAll('#access tbody tr').length === 2, { polling: 50, timeout: U.shortTimeout });
    const row = '#access tbody tr:nth-child(2)';
    const shown = await page.$eval(`${row} input[role="searchbox"]`, (input) => input.value);
    assert.equal(shown, collab.username);
    const name = await page.$eval(`${row} td:nth-child(2) input`, (input) => input.value);
    assert.equal(name, collab.name);

    const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/project/json/${SHORTNAME}`), { timeout: U.shortTimeout });
    const [save] = await page.$$('xpath///button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    const res = await answer;
    const body = await res.json();
    assert.equal(res.status(), 200, JSON.stringify(body));

    const stored = (await U.queryProject(SHORTNAME)).collaborators.list;
    assert.lengthOf(stored, 2);
    assert.include(stored[0], { username: 'anyone', userID: 'anyone' });
    assert.include(stored[1], { username: collab.username, userID: collab.username });
    assert.deepEqual(stored[1].access, access);
  }).timeout(U.mediumTimeout);
});
