/* global Microdraw */
'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

/*
  T002 3.6: the admin page's sections "Damaged projects" (restore the files
  an incomplete save removed), "Datasets" (find one, change its owner and
  name, remove a user's annotations and undo it) and "Message to everyone
  connected" (a viewer shows it, as text, until dismissed). The routes
  themselves are tested in test/api/admin-tools.spec.js.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const admins = require('../../app/controller/admin/admins');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');
const H = require('./helpers');

const adminUser = { username: 'e2e-adm36-admin', password: 'e2e-adm36-admin-password' };
const access = { files: 'view', annotations: 'edit', collaborators: 'none' };
const row = (i) => ({ source: `https://example.org/e2e-adm36/f${i}.json`, name: `file ${i}` });
const rows = (n) => Array.from({ length: n }, (x, i) => row(i));
const DS = 'https://example.org/e2e-adm36/dataset.json';
const project = (shortname, list, extra = {}) => ({
  name: shortname,
  shortname,
  url: '',
  owner: adminUser.username,
  collaborators: { list: [{ username: 'anyone', name: 'Any User', access }] },
  files: { list },
  annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set I', display: true }] },
  ...extra
});
const viewerProject = U.createPublicAnnotationProject('e2eadm36viewer');
const shortnames = ['e2eadm36inc', 'e2eadm36stale', 'e2eadm36ds', viewerProject.shortname];
const region = (slice, user) => ({ fileID: `${DS}&slice=${slice}`, project: 'e2eadm36ds', user, Hash: 'h', annotation: { name: 'r', path: [] } });

describe('Admin page: damaged projects, datasets, message (T002 3.6)', () => {
  let context;
  let page;
  let previousAdmins;

  const waitFor = (fn, ...args) => page.waitForFunction(fn, { polling: 50, timeout: U.shortTimeout }, ...args);
  const current = (shortname) => U.getDB().collection('projects')
    .findOne({ shortname, backup: { $exists: false } }, { sort: { _id: -1 } });
  const cleanup = async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await U.removeAnnotations(DS);
    await U.getDB().collection('datasets')
      .deleteMany({ source: /^https:\/\/example\.org\/e2e-adm36\// });
    await U.getDB().collection('log')
      .deleteMany({ key: /^admin/, $or: [{ 'value.shortname': { $in: shortnames } }, { 'value.source': DS }, { 'value.username': adminUser.username }] });
  };
  const type = async (selector, text) => {
    await page.click(selector, { count: 3 });
    await page.type(selector, text);
  };

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([adminUser.username]);
    await cleanup();
    await U.getDB().collection('projects')
      .insertOne(project('e2eadm36inc', rows(102), { backup: true }));
    await U.getDB().collection('projects')
      .insertOne(project('e2eadm36inc', rows(100)));
    await U.getDB().collection('projects')
      .insertOne(project('e2eadm36stale', rows(102), { backup: true }));
    await U.getDB().collection('projects')
      .insertOne(project('e2eadm36stale', rows(100)));
    await U.insertProject([project('e2eadm36ds', [{ source: DS, name: 'brain' }]), { ...viewerProject }]);
    await U.getDB().collection('datasets')
      .insertOne({ source: DS, name: 'slideFiles', owner: 'wwlOath', included: '2026-10-20T00:00:00.000Z' });
    await U.insertAnnotations([region(0, 'u1'), region(1, 'u1'), region(0, 'u2')]);
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

  it('Damaged projects: finds the incomplete save, and Restore files adds its files back', async () => {
    const sel = '#damaged-projects div.project[data-shortname="e2eadm36inc"]';
    await page.goto(U.url('/admin'), { waitUntil: 'load' });
    await page.click('#damaged-projects button.find-damaged');
    await waitFor((s) => document.querySelector(s), sel);
    const text = await page.$eval(`${sel} li.event`, (li) => li.textContent);
    assert.include(text, 'incomplete save');
    assert.include(text, '102 → 100 files');
    assert.include(text, '2 still missing');

    await page.click(`${sel} button.restore-files`);
    await waitFor((s) => document.querySelector('#damaged-projects button.undo-restore-files') && !document.querySelector(s), sel);
    assert.include(await page.$eval('#damaged-projects p.result', (p) => p.textContent), 'restored 2 file(s), it has 102 now');
    assert.deepEqual((await current('e2eadm36inc')).files.list, rows(102));
  }).timeout(U.mediumTimeout);

  it('Damaged projects: the 409 of a project changed since it was listed stays shown after the list is read again', async () => {
    const sel = '#damaged-projects div.project[data-shortname="e2eadm36stale"]';
    let lists = 0;
    const countLists = (response) => {
      if (response.url().includes('/admin/json/projects/damaged')) {
        lists += 1;
      }
    };
    await page.goto(U.url('/admin'), { waitUntil: 'load' });
    await page.click('#damaged-projects button.find-damaged');
    await waitFor((s) => document.querySelector(s), sel);
    // the project changes after it was listed: its version token is stale
    await U.getDB().collection('projects')
      .updateOne({ shortname: 'e2eadm36stale', backup: { $exists: false } }, { $set: { name: 'changed' } });

    page.on('response', countLists);
    try {
      await page.click(`${sel} button.restore-files`);
      await waitFor(() => {
        const button = document.querySelector('#damaged-projects button.find-damaged');

        return document.querySelector('#damaged-projects p.error') && !button.disabled;
      });
    } finally {
      page.off('response', countLists);
    }
    assert.equal(lists, 1, 'the list was read again after the fix');
    assert.include(await page.$eval('#damaged-projects p.error', (p) => p.textContent), 'Project e2eadm36stale has changed since it was listed');
    assert.isNull(await page.$('#damaged-projects p.result'));
    assert.deepEqual((await current('e2eadm36stale')).files.list, rows(100));
  }).timeout(U.mediumTimeout);

  it('Datasets: finds a dataset, changes its owner and name, removes a user\'s annotations and undoes it', async () => {
    const userRow = '#datasets tr.annotations[data-project="e2eadm36ds"][data-user="u1"]';
    await type('#datasets input.dataset-source', DS);
    await page.click('#datasets button.find-dataset');
    await waitFor((s) => document.querySelector(s), userRow);
    assert.equal(await page.$eval('#datasets input.dataset-owner', (i) => i.value), 'wwlOath');
    assert.equal(await page.$eval('#datasets input.dataset-name', (i) => i.value), 'slideFiles');
    assert.include(await page.$eval('#datasets ul.dataset-projects', (ul) => ul.textContent), 'e2eadm36ds');
    assert.deepEqual(await page.$eval(userRow, (tr) => [tr.querySelector('.regions').textContent, tr.querySelector('.slices').textContent]), ['2', '2']);
    assert.include(await page.$eval('#datasets p.viewers', (p) => p.textContent), 'Nobody');

    await type('#datasets input.dataset-owner', adminUser.username);
    await type('#datasets input.dataset-name', 'BigBrain');
    await page.click('#datasets button.update-dataset');
    await waitFor(() => (document.querySelector('#datasets p.result') || {}).textContent);
    const doc = await U.getDB().collection('datasets')
      .findOne({ source: DS });
    assert.deepInclude(doc, { owner: adminUser.username, name: 'BigBrain' });

    await page.click(`${userRow} button.remove-user`);
    await waitFor((s) => !document.querySelector(s) && document.querySelector('#datasets button.undo-remove'), userRow);
    assert.lengthOf(await U.findAnnotations({ project: 'e2eadm36ds', user: 'u1' }), 0);
    assert.lengthOf(await U.findAnnotations({ project: 'e2eadm36ds', user: 'u2' }), 1);

    await page.click('#datasets button.undo-remove');
    await waitFor((s) => document.querySelector(s), userRow);
    assert.lengthOf(await U.findAnnotations({ project: 'e2eadm36ds', user: 'u1' }), 2);
  }).timeout(U.mediumTimeout);

  it('Message to everyone connected: a viewer shows it as text until dismissed', async () => {
    const viewer = await context.newPage();
    try {
      await viewer.setViewport({ width: U.width, height: U.height });
      await H.openData(viewer, U.url(`/data?source=/test_data/cat.json&project=${viewerProject.shortname}&slice=0`));
      // the viewer's connection has joined its slice's room: it is connected
      const target = { project: viewerProject.shortname, source: '/test_data/cat.json', slice: '0' };
      const deadline = Date.now() + U.shortTimeout;
      while (wsModule._roomSize(target) < 1) {
        assert.isBelow(Date.now(), deadline, 'the viewer joins its slice');
        // eslint-disable-next-line no-await-in-loop
        await U.delay(20);
      }

      const message = 'Restart at 18:00 <b>sharp</b>';
      await page.bringToFront();
      await type('#broadcast input.broadcast-message', message);
      await page.click('#broadcast button.send-broadcast');
      await waitFor(() => (document.querySelector('#broadcast p.result') || {}).textContent);
      assert.match(await page.$eval('#broadcast p.result', (p) => p.textContent), /^Sent to \d+ connected viewers?\.$/);

      const notice = () => viewer.evaluate(() => {
        const el = Microdraw.dom.querySelector('#adminNotice');

        return { shown: el.classList.contains('shown'), display: getComputedStyle(el).display, text: el.querySelector('.text').textContent, html: Boolean(el.querySelector('.text b')) };
      });
      await viewer.waitForFunction(() => Microdraw.dom.querySelector('#adminNotice').classList.contains('shown'), { polling: 50, timeout: U.shortTimeout });
      assert.deepEqual(await notice(), { shown: true, display: 'flex', text: message, html: false });

      const close = await viewer.evaluateHandle(() => Microdraw.dom.querySelector('#adminNotice button.close'));
      await viewer.bringToFront();
      await close.click();
      assert.deepInclude(await notice(), { shown: false, display: 'none' });
    } finally {
      await viewer.close();
    }
  }).timeout(U.mediumTimeout);
});
