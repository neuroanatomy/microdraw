'use strict';

/*
  The user page lists all the user's projects, not only the first 100 (it reads
  /user/json/:user/projects 100 at a time until a page is short), and its
  columns sort with nwl-components' SortableTh: a sort icon on every header
  from the start, a first click sorts ascending, a second reverses.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = 'e2e-user-page-owner';
const PREFIX = 'e2euserpage';
const COUNT = 105;
const HEADERS = ['Name', 'Files', 'Collaborators', 'Owner', 'Last modified'];

// The server order is not the sorted order: the first project is "P050" with 5 files.
const name = (i) => `P${String(((i * 37) + 50) % COUNT).padStart(3, '0')}`;
const numFiles = (i) => ((i + 4) % 12) + 1;

const project = (i) => {
  const p = U.createProjectWithPermission(`${PREFIX}${String(i).padStart(3, '0')}`, { files: 'view' });
  p.name = name(i);
  p.owner = owner;
  p.collaborators.list[0].access.files = 'view';
  p.files.list = Array.from({ length: numFiles(i) }, (_, k) => ({ source: `/test_data/${i}-${k}.json`, name: `f${k}` }));

  return p;
};

const removeAll = () => U.getDB().get('projects')
  .remove({ shortname: { $regex: `^${PREFIX}` } });

describe('User page: all projects, sortable columns', () => {
  let context;
  let page;

  const firstRow = () => page.$eval('#projects tbody tr', (tr) => [...tr.cells].map((td) => td.textContent.trim()));
  const clickHeader = async (label) => {
    const headers = await page.$$('#projects thead th');
    const texts = await Promise.all(headers.map((th) => th.evaluate((el) => el.textContent.trim())));
    const button = await headers[texts.indexOf(label)].$('button');
    await button.click();
  };

  before(async () => {
    await removeAll();
    await U.insertUser({ username: owner, name: owner, joined: new Date() });
    await U.insertProject(Array.from({ length: COUNT }, (_, i) => project(i)));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await removeAll();
      await U.removeLocalUser(owner);
    }
  });

  it(`shows all ${COUNT} projects and counts them`, async () => {
    await page.goto(U.url(`/user/${owner}`), { waitUntil: 'load' });
    await page.waitForFunction((n) => document.querySelectorAll('#projects tbody tr').length === n,
      { timeout: U.mediumTimeout }, COUNT);
    const text = await page.evaluate(() => document.body.innerText);
    assert.include(text, `${COUNT} Projects`);
    assert.deepEqual((await firstRow()).slice(0, 2), ['P050', '5'], 'unsorted: server order');
  }).timeout(U.mediumTimeout);

  it('shows a sort icon on every header before any click', async () => {
    const headers = await page.$$eval('#projects thead th', (ths) => ths.map((th) => ({
      text: th.textContent.trim(),
      icon: Boolean(th.querySelector('svg')),
      sort: th.getAttribute('aria-sort')
    })));
    assert.deepEqual(headers.map((h) => h.text), HEADERS);
    headers.forEach((h) => {
      assert.isTrue(h.icon, `no sort icon on ${h.text}`);
      assert.equal(h.sort, 'none', h.text);
    });
  }).timeout(U.shortTimeout);

  it('sorts by name on a click, reversed on a second click', async () => {
    await clickHeader('Name');
    assert.equal((await firstRow())[0], 'P000');
    await clickHeader('Name');
    assert.equal((await firstRow())[0], 'P104');
  }).timeout(U.shortTimeout);

  it('sorts Files as numbers', async () => {
    await clickHeader('Files');
    assert.equal((await firstRow())[1], '1');
    await clickHeader('Files');
    assert.equal((await firstRow())[1], '12');
  }).timeout(U.shortTimeout);
});
