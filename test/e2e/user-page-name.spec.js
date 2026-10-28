'use strict';

/*
  The Name column of the user page shows the project's display name, or its
  short name when the display name is missing or empty, as in BrainBox. It sorts
  by what it shows, and links by the short name.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = 'e2e-user-page-name-owner';
const PREFIX = 'e2euserpagename';

// in the server's order: short name, display name (none for d, empty for a)
const PROJECTS = [
  [`${PREFIX}b`, 'Zeta study'],
  [`${PREFIX}d`],
  [`${PREFIX}c`, 'Alpha study'],
  [`${PREFIX}a`, '']
];

const project = ([shortname, name]) => {
  const p = U.createProjectWithPermission(shortname, { files: 'view' });
  p.owner = owner;
  p.collaborators.list[0].access.files = 'view';
  if (typeof name === 'undefined') {
    delete p.name;
  } else {
    p.name = name;
  }

  return p;
};

const removeAll = () => U.getDB().get('projects')
  .remove({ shortname: { $regex: `^${PREFIX}` } });

describe('User page: the Name column', () => {
  let context;
  let page;

  // the shown name and the project link of every row, top to bottom
  const names = () => page.$$eval('#projects tbody tr', (trs) => trs.map((tr) => tr.cells[0].textContent.trim()));
  const links = () => page.$$eval('#projects tbody tr', (trs) => trs.map((tr) => tr.cells[0].querySelectorAll('a')[1].getAttribute('href')));
  const clickName = async () => {
    const [th] = await page.$$('#projects thead th');
    await (await th.$('button')).click();
  };

  before(async () => {
    await removeAll();
    await U.insertUser({ username: owner, name: owner, joined: new Date() });
    await U.insertProject(PROJECTS.map(project));
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

  it('shows the display name, or the short name when it is missing or empty, and links by the short name', async () => {
    await page.goto(U.url(`/user/${owner}`), { waitUntil: 'load' });
    await page.waitForFunction((n) => document.querySelectorAll('#projects tbody tr').length === n,
      { timeout: U.mediumTimeout }, PROJECTS.length);
    assert.deepEqual(await names(), ['Zeta study', `${PREFIX}d`, 'Alpha study', `${PREFIX}a`]);
    assert.deepEqual(await links(), PROJECTS.map(([shortname]) => `/project/${shortname}`));
  }).timeout(U.mediumTimeout);

  it('sorts by the shown name on a click, reversed on a second click', async () => {
    await clickName();
    assert.deepEqual(await names(), ['Alpha study', `${PREFIX}a`, `${PREFIX}d`, 'Zeta study']);
    await clickName();
    assert.deepEqual(await names(), ['Zeta study', `${PREFIX}d`, `${PREFIX}a`, 'Alpha study']);
  }).timeout(U.shortTimeout);
});
