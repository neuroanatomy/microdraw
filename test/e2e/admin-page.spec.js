'use strict';

/*
  A1: the admin page lists the orphan annotations (decisions D26); Delete
  removes the row (the documents become backups) and Undo brings it back.
  The routes themselves are tested in test/api/admin.spec.js.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const SOURCE = 'http://a1-admin-page.localhost/brain.dzi';
const adminUser = { username: 'e2e-a1-admin', password: 'e2e-a1-admin-password' };
const orphan = (user, name) => ({
  fileID: `${SOURCE}&slice=0`,
  user,
  project: '',
  Hash: 'h',
  annotation: { name, uid: `e2e-a1-${name}`, path: ['Path', { segments: [[0, 0], [10, 10], [20, 0]], closed: true }] }
});

describe('Admin page (A1)', () => {
  let context;
  let page;
  let previousAdmins;

  const rows = () => page.$$eval('#orphan-list tr.orphan', (trs) => trs.map((tr) => ({
    user: tr.querySelector('td.user').textContent.trim(),
    regions: tr.querySelector('td.regions').textContent.trim(),
    source: tr.querySelector('td.source').textContent.trim()
  })));
  const waitForRows = (n) => page.waitForFunction(
    (count) => document.querySelectorAll('#orphan-list tr.orphan').length === count,
    { polling: 50, timeout: U.shortTimeout },
    n
  );

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([adminUser.username]);
    await U.removeAnnotations(SOURCE);
    await U.insertAnnotations([orphan('alice', 'a1'), orphan('alice', 'a2'), orphan('bob', 'b1')]);
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
      await U.removeAnnotations(SOURCE);
      await U.getDB().get('log')
        .remove({ key: /^admin/, 'value.fileID': `${SOURCE}&slice=0` });
    }
  });

  it('lists the orphan annotations of the image, by author', async () => {
    await page.goto(U.url(`/admin?source=${encodeURIComponent(SOURCE)}`), { waitUntil: 'load' });
    await waitForRows(2);
    const list = await rows();
    assert.sameDeepMembers(list, [
      { user: 'alice', regions: '2', source: SOURCE },
      { user: 'bob', regions: '1', source: SOURCE }
    ]);
    assert.include(await page.$eval('#orphans .help', (p) => p.textContent), 'can be undone');
  }).timeout(U.mediumTimeout);

  it('Delete removes the row, and Undo brings it back', async () => {
    const bobRow = await page.evaluateHandle(() => [...document.querySelectorAll('#orphan-list tr.orphan')]
      .find((tr) => tr.querySelector('td.user').textContent.trim() === 'bob'));
    await (await bobRow.$('button.delete')).click();
    await waitForRows(1);
    assert.deepEqual((await rows()).map((r) => r.user), ['alice']);
    assert.equal((await U.findAnnotations({ fileID: `${SOURCE}&slice=0`, user: 'bob' })).length, 0);

    await page.click('button.undo');
    await waitForRows(2);
    assert.equal((await U.findAnnotations({ fileID: `${SOURCE}&slice=0`, user: 'bob' })).length, 1);
  }).timeout(U.mediumTimeout);
});
