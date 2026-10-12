'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

/*
  A3: the "Projects" tool of the admin page (decisions D31): search a project,
  Delete… (confirmed; annotations become backups) and Restore, Transfer
  ownership… to a user found by a search, and Restore. The same two actions on
  each project of "Projects that don't validate". The routes themselves are
  tested in test/api/admin-project-actions.spec.js.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');

const H = require('./helpers');

const adminUser = { username: 'e2e-a3-admin', password: 'e2e-a3-admin-password' };
const heir = { username: 'e2e-a3-heir', password: 'e2e-a3-heir-password' };
const access = { files: 'view', annotations: 'view', collaborators: 'view' };
const img = 'e2e-a3-histo.dzi';
// shaped like production's HistoPath: missing owner, an unnamed layer
const histo = {
  name: 'A3 e2e Histo',
  shortname: 'a3e2ehisto',
  url: '',
  owner: 'e2e-a3-voyageour',
  collaborators: { list: [{ username: 'anyone', access }] },
  files: { list: [{ source: img, name: 'histo' }] },
  annotations: { list: [{ type: 'vectorial', name: '', values: 'Set 1', display: true }] }
};
const region = (n) => ({
  fileID: `${img}&slice=0`,
  user: 'e2e-a3-voyageour',
  project: histo.shortname,
  Hash: `e2e-a3-${n}`,
  annotation: { name: `region ${n}`, path: ['Path', { segments: [[n, n], [n + 10, n], [n, n + 10]], closed: true }] }
});

describe('Admin page: delete a project, transfer ownership (A3)', () => {
  let context;
  let page;
  let previousAdmins;
  const dialogs = [];

  const found = `#project-tools div.project[data-shortname="${histo.shortname}"]`;
  const invalid = `#invalid-projects div.project[data-shortname="${histo.shortname}"]`;
  const waitFor = (fn, ...args) => page.waitForFunction(fn, { polling: 50, timeout: U.shortTimeout }, ...args);
  const stored = () => U.getDB().get('projects')
    .findOne({ shortname: histo.shortname });
  const current = () => U.findAnnotations({ project: histo.shortname });
  const cleanup = async () => {
    await U.removeProject(histo.shortname);
    await U.removeProjectAnnotations(histo.shortname);
    await U.getDB().get('log')
      .remove({ 'value.shortname': histo.shortname });
  };
  const search = async () => {
    await page.click('#project-tools input.project-search', { clickCount: 3 });
    await page.type('#project-tools input.project-search', 'A3 E2E histo');
    await page.click('#project-tools button.do-search');
    await waitFor((s) => document.querySelector(s), found);
  };

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([adminUser.username]);
    await cleanup();
    await U.signUp(heir);
    await U.insertProject({ ...histo });
    await U.insertAnnotations([region(1), region(2)]);
    context = await H.newContext();
    page = await context.newPage();
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.accept();
    });
    await H.logIn(page, adminUser);
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    await context.close();
    await cleanup();
    await U.removeLocalUser(adminUser.username);
    await U.removeLocalUser(heir.username);
  });

  it('finds a project by name, flags its missing owner, and offers the two actions', async () => {
    await page.goto(U.url('/admin'), { waitUntil: 'load' });
    await search();
    const shown = await page.$eval(found, (div) => ({
      title: div.querySelector('h3').textContent,
      owner: div.querySelector('.owner').textContent,
      missing: Boolean(div.querySelector('.owner .tag')),
      counts: div.querySelector('.counts').textContent,
      buttons: [...div.querySelectorAll('button')].map((b) => b.textContent.trim())
    }));
    assert.include(shown.title, histo.shortname);
    assert.include(shown.owner, 'e2e-a3-voyageour');
    assert.isTrue(shown.missing);
    assert.include(shown.counts, '2 annotations');
    assert.includeMembers(shown.buttons, ['Delete…', 'Transfer ownership…']);

    // the same actions in "Projects that don't validate"
    await waitFor((s) => document.querySelector(s), invalid);
    const buttons = await page.$$eval(`${invalid} .project-actions button`, (bs) => bs.map((b) => b.textContent.trim()));
    assert.includeMembers(buttons, ['Delete…', 'Transfer ownership…']);
  }).timeout(U.mediumTimeout);

  it('Delete… asks for confirmation, deletes; Restore brings back the project and its annotations', async () => {
    const before = await stored();
    dialogs.length = 0;
    await page.click(`${found} button.delete-project`);
    await waitFor(() => document.querySelector('#project-tools button.restore-action'));
    assert.lengthOf(dialogs, 1);
    assert.include(dialogs[0], 'backups');
    assert.include(dialogs[0], 'restore');
    assert.isNull(await stored());
    assert.lengthOf(await current(), 0);
    assert.include(await page.$eval('#project-tools p.result', (p) => p.textContent), 'Deleted');
    await waitFor((s) => !document.querySelector(s), found);

    await page.click('#project-tools button.restore-action');
    await waitFor((s) => document.querySelector(s), found);
    assert.deepEqual(await stored(), before);
    assert.lengthOf(await current(), 2);
  }).timeout(U.mediumTimeout);

  it('Transfer ownership… gives the project to a user found by a search; Restore gives it back', async () => {
    await page.click(`${found} button.transfer`);
    await page.type(`${found} input.user-search`, 'e2e-a3-he');
    await waitFor((s) => document.querySelector(`${s} button.pick-user[data-username="e2e-a3-heir"]`), found);
    await page.click(`${found} button.pick-user[data-username="e2e-a3-heir"]`);
    await page.click(`${found} button.do-transfer`);
    await waitFor(() => document.querySelector('#project-tools button.restore-action'));
    assert.equal((await stored()).owner, heir.username);
    await waitFor((s) => !document.querySelector(`${s} .owner .tag`), found);
    assert.include(await page.$eval(`${found} .owner`, (span) => span.textContent), heir.username);

    await page.click('#project-tools button.restore-action');
    await waitFor((s) => document.querySelector(`${s} .owner .tag`), found);
    assert.equal((await stored()).owner, histo.owner);
  }).timeout(U.mediumTimeout);

  it('Delete… from "Projects that don\'t validate", and Restore there', async () => {
    await page.click(`${invalid} button.delete-project`);
    await waitFor(() => document.querySelector('#invalid-projects button.restore-action'));
    assert.isNull(await stored());
    await waitFor((s) => !document.querySelector(s), invalid);
    await page.click('#invalid-projects button.restore-action');
    await waitFor((s) => document.querySelector(s), invalid);
    assert.lengthOf(await current(), 2);
  }).timeout(U.mediumTimeout);
});
