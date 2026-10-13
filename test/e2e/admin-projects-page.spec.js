'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

/*
  A2: the admin page lists the stored projects that don't validate (decisions
  D29); "Remove blank rows" removes them, "Restore" puts the previous version
  back, "Name unnamed layers" names the layers with the names typed. The
  routes themselves are tested in test/api/admin-projects.spec.js.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');

const H = require('./helpers');

const adminUser = { username: 'e2e-a2-admin', password: 'e2e-a2-admin-password' };
const access = { files: 'view', annotations: 'view', collaborators: 'view' };
const blankProject = {
  name: 'A2 e2e blank rows',
  shortname: 'a2e2eblank',
  url: '',
  owner: adminUser.username,
  collaborators: { list: [{ username: 'anyone', access }, { username: '', access }] },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }, { source: '', name: 'empty 1' }, { source: '', name: '' }] },
  annotations: { list: [{ type: 'vectorial', name: 'layer', values: '', display: true }] }
};
const unnamedProject = {
  name: 'A2 e2e unnamed layer',
  shortname: 'a2e2eunnamed',
  url: '',
  owner: adminUser.username,
  collaborators: { list: [{ username: 'anyone', access }] },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'vectorial', name: '', values: 'Set 1', display: true }] }
};
const shortnames = [blankProject.shortname, unnamedProject.shortname];

describe('Admin page: projects that don\'t validate (A2)', () => {
  let context;
  let page;
  let previousAdmins;

  const sel = (shortname) => `#invalid-projects div.project[data-shortname="${shortname}"]`;
  const waitFor = (fn, ...args) => page.waitForFunction(fn, { polling: 50, timeout: U.shortTimeout }, ...args);
  const stored = (shortname) => U.getDB().get('projects')
    .findOne({ shortname });
  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await U.getDB().get('log')
      .remove({ key: /^admin/, 'value.shortname': { $in: shortnames } });
  };

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([adminUser.username]);
    await cleanup();
    await U.insertProject([{ ...blankProject }, { ...unnamedProject }]);
    context = await H.newContext();
    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await H.logIn(page, adminUser);
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await cleanup();
      await U.removeLocalUser(adminUser.username);
    }
  });

  it('lists the projects with their problems, the fixes and a link to the settings', async () => {
    await page.goto(U.url('/admin'), { waitUntil: 'load' });
    await waitFor((s) => document.querySelector(s), sel(blankProject.shortname));
    const blank = await page.$eval(sel(blankProject.shortname), (div) => ({
      problems: [...div.querySelectorAll('li.problem')].map((li) => li.textContent.trim()),
      button: div.querySelector('button.remove-blank').textContent.trim(),
      settings: div.querySelector('a.settings').getAttribute('href'),
      nameForm: Boolean(div.querySelector('form.name-layers'))
    }));
    assert.equal(blank.button, 'Remove blank rows (3)');
    assert.equal(blank.settings, `/project/${blankProject.shortname}/settings`);
    assert.isFalse(blank.nameForm);
    assert.isTrue(blank.problems.some((p) => p.includes('File 2 needs a source')));
    assert.isTrue(blank.problems.some((p) => p.includes('missing user')));

    const unnamed = await page.$eval(sel(unnamedProject.shortname), (div) => ({
      remove: Boolean(div.querySelector('button.remove-blank')),
      proposed: [...div.querySelectorAll('form.name-layers input')].map((i) => i.value)
    }));
    assert.isFalse(unnamed.remove);
    assert.deepEqual(unnamed.proposed, ['Layer 1']);
  }).timeout(U.mediumTimeout);

  it('Remove blank rows removes them, and Restore puts them back', async () => {
    await page.click(`${sel(blankProject.shortname)} button.remove-blank`);
    // nothing else is wrong with it: it leaves the list
    await waitFor((s) => document.querySelector('#invalid-projects button.restore') && !document.querySelector(s), sel(blankProject.shortname));
    let doc = await stored(blankProject.shortname);
    assert.deepEqual(doc.files.list, [blankProject.files.list[0]]);
    assert.deepEqual(doc.collaborators.list, [blankProject.collaborators.list[0]]);
    assert.include(await page.$eval('#invalid-projects p.result', (p) => p.textContent), 'Removed 2 files, 1 collaborators');

    await page.click('#invalid-projects button.restore');
    await waitFor((s) => document.querySelector(`${s} button.remove-blank`), sel(blankProject.shortname));
    doc = await stored(blankProject.shortname);
    assert.deepEqual(doc.files.list, blankProject.files.list);
    assert.deepEqual(doc.collaborators.list, blankProject.collaborators.list);
  }).timeout(U.mediumTimeout);

  it('Name unnamed layers uses the names typed, and the project leaves the list', async () => {
    const input = `${sel(unnamedProject.shortname)} form.name-layers input`;
    await page.click(input, { count: 3 });
    await page.type(input, 'Cortex');
    await page.click(`${sel(unnamedProject.shortname)} button.do-name-layers`);
    await waitFor((s) => !document.querySelector(s), sel(unnamedProject.shortname));
    const doc = await stored(unnamedProject.shortname);
    assert.equal(doc.annotations.list[0].name, 'Cortex');
    assert.equal(doc.annotations.list[0].values, 'Set 1');
  }).timeout(U.mediumTimeout);
});
