'use strict';

/*
  T002 3.4: the user page's Datasets and Annotations tabs. Datasets lists the
  user's datasets (Name links to the viewer, in the project when one is
  listed; Projects link to the projects; Included), Annotations one row per
  dataset and project the user annotated (Dataset links to the viewer in the
  project, Project to the project; Slices; Last modified). Both sort by a
  click on a header, show a short line when empty, and list only what the
  visitor may see: a logged-out visitor sees no row of a private project, a
  collaborator of it does.
*/
const { assert } = require('chai');
const { ObjectId } = require('neuroweblab');
const U = require('../mocha.test.util');
const H = require('./helpers');

const PREFIX = 'e2eusertabs';
const owner = `${PREFIX}-owner`;
const nobody = `${PREFIX}-nobody`;
const member = { username: `${PREFIX}-member`, password: `${PREFIX}-member-password` };

// the viewer's test images, as http URLs (the server's port is known at run time)
const catURL = () => U.url('/test_data/cat.json');
const zarrURL = () => U.url('/test_data/cat-zarr.json');
const PRIV = 'https://e2eusertabs.localhost/private.json';

const makeProject = (shortname, anyone, memberAccess, files) => {
  const p = U.createProjectWithPermission(shortname, {});
  p.owner = owner;
  p.collaborators.list = [{ username: 'anyone', access: { collaborators: 'none', ...anyone }, name: 'Any User' }];
  if (memberAccess) {
    p.collaborators.list.push({ username: member.username, userID: member.username, access: { collaborators: 'none', ...memberAccess } });
  }
  p.files.list = files;

  return p;
};

const day = (n) => new Date(Date.UTC(2026, 0, n, 12)).toJSON();
let counter = 0;
const annotation = (projectName, source, slice, n) => {
  counter += 1;
  const seconds = Math.floor(Date.UTC(2026, 1, n, 12) / 1000);

  return {
    _id: new ObjectId(seconds.toString(16).padStart(8, '0') + counter.toString(16).padStart(16, '0')),
    fileID: `${source}&slice=${slice}`,
    user: owner,
    project: projectName,
    Hash: 'h',
    annotation: { path: [] }
  };
};

const removeAll = async () => {
  const db = U.getDB();
  await db.collection('projects').deleteMany({ shortname: { $regex: `^${PREFIX}` } });
  await db.collection('datasets').deleteMany({ owner });
  await db.collection('annotations').deleteMany({ user: owner });
  await db.collection('users').deleteMany({ username: { $in: [owner, nobody, member.username] } });
};

// In the page: the cells of a table, row by row
const cells = (page, table) => page.$$eval(`#${table} tbody tr`, (trs) => trs.map((tr) => [...tr.cells].map((td) => td.textContent.trim())));
// In the page: the href of every link of one column, row by row
const hrefs = (page, table, col) => page.$$eval(`#${table} tbody tr`, (trs, c) => trs
  .map((tr) => [...tr.cells[c].querySelectorAll('a')].map((a) => a.getAttribute('href'))), col);

const openTab = async (page, title) => {
  await page.$$eval('li[role=tab]', (lis, t) => lis.find((li) => li.textContent.trim() === t).click(), title);
};
const waitRows = (page, table, n) => page.waitForFunction((t, k) => document.querySelectorAll(`#${t} tbody tr`).length === k,
  { timeout: U.mediumTimeout }, table, n);
const clickHeader = async (page, table, label) => {
  await page.$$eval(`#${table} thead th`, (ths, l) => ths.find((th) => th.textContent.trim() === l).querySelector('button')
    .click(), label);
};
// The status of a GET of a link of the page
const statusOf = (page, href) => page.evaluate(async (h) => (await fetch(h)).status, href);

// eslint-disable-next-line max-statements -- one page, one `it` per check
describe('User page: Datasets and Annotations tabs', () => {
  let pub;
  let priv;
  let context;
  let page;

  // eslint-disable-next-line max-statements -- the fixture: users, projects, datasets, annotations
  before(async () => {
    await removeAll();
    pub = makeProject(`${PREFIX}pub`, { files: 'view', annotations: 'view' }, null,
      [{ source: catURL(), name: 'cat' }, { source: zarrURL(), name: 'zarr' }]);
    priv = makeProject(`${PREFIX}priv`, { files: 'none', annotations: 'none' }, { files: 'view', annotations: 'view' },
      [{ source: PRIV, name: 'private' }]);
    for (const username of [owner, nobody]) {
      // eslint-disable-next-line no-await-in-loop
      await U.insertUser({ username, name: username, joined: new Date() });
    }
    await U.insertProject([pub, priv]);
    await U.getDB().collection('datasets')
      .insertMany([
        { source: catURL(), name: 'Cat dataset', owner, included: day(1) },
        { source: zarrURL(), name: 'Zarr dataset', owner, included: day(2) },
        { source: PRIV, name: 'Private dataset', owner, included: day(3) }
      ]);
    await U.insertAnnotations([
      annotation(pub.shortname, catURL(), 0, 1),
      annotation(pub.shortname, catURL(), 1, 2),
      annotation(pub.shortname, zarrURL(), 0, 3),
      annotation(priv.shortname, PRIV, 0, 4)
    ]);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await removeAll();
    }
  });

  // eslint-disable-next-line max-statements -- rows, then each link
  it('Datasets: a logged-out visitor sees the public datasets, newest first, with working links', async () => {
    await page.goto(U.url(`/user/${owner}`), { waitUntil: 'load' });
    await openTab(page, 'Datasets');
    await waitRows(page, 'datasets', 2);
    const rows = await cells(page, 'datasets');
    assert.deepEqual(rows.map((r) => r.slice(0, 2)), [['Zarr dataset', pub.shortname], ['Cat dataset', pub.shortname]]);
    assert.notInclude(JSON.stringify(rows), 'Private dataset');
    const names = await hrefs(page, 'datasets', 0);
    assert.deepEqual(names[0], [`/data?source=${encodeURIComponent(zarrURL())}&project=${pub.shortname}`]);
    assert.deepEqual((await hrefs(page, 'datasets', 1))[0], [`/project/${pub.shortname}`]);
    assert.equal(await statusOf(page, names[0][0]), 200);
    assert.equal(await statusOf(page, `/project/${pub.shortname}`), 200);
  }).timeout(U.mediumTimeout);

  it('Datasets: sorts by name, reversed on a second click', async () => {
    await clickHeader(page, 'datasets', 'Name');
    assert.deepEqual((await cells(page, 'datasets')).map((r) => r[0]), ['Cat dataset', 'Zarr dataset']);
    await clickHeader(page, 'datasets', 'Name');
    assert.deepEqual((await cells(page, 'datasets')).map((r) => r[0]), ['Zarr dataset', 'Cat dataset']);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements -- rows, then each link
  it('Annotations: one row per dataset and project, with working links', async () => {
    await openTab(page, 'Annotations');
    await waitRows(page, 'annotations', 2);
    const rows = await cells(page, 'annotations');
    assert.deepEqual(rows.map((r) => r.slice(0, 3)), [['Zarr dataset', pub.shortname, '1'], ['Cat dataset', pub.shortname, '2']]);
    assert.notInclude(JSON.stringify(rows), 'Private dataset');
    const links = await hrefs(page, 'annotations', 0);
    assert.deepEqual(links[1], [`/data?source=${encodeURIComponent(catURL())}&project=${pub.shortname}`]);
    assert.deepEqual((await hrefs(page, 'annotations', 1))[1], [`/project/${pub.shortname}`]);
    assert.equal(await statusOf(page, links[1][0]), 200);
  }).timeout(U.mediumTimeout);

  it('Annotations: sorts by slices, reversed on a second click', async () => {
    await clickHeader(page, 'annotations', 'Slices');
    assert.deepEqual((await cells(page, 'annotations')).map((r) => r[2]), ['1', '2']);
    await clickHeader(page, 'annotations', 'Slices');
    assert.deepEqual((await cells(page, 'annotations')).map((r) => r[2]), ['2', '1']);
  }).timeout(U.shortTimeout);

  // eslint-disable-next-line max-statements -- log in, then both tabs
  it('a collaborator of the private project sees its rows in both tabs', async () => {
    const memberContext = await H.newContext();
    try {
      const memberPage = await memberContext.newPage();
      await H.logIn(memberPage, member);
      await memberPage.goto(U.url(`/user/${owner}`), { waitUntil: 'load' });
      await openTab(memberPage, 'Datasets');
      await waitRows(memberPage, 'datasets', 3);
      assert.deepEqual((await cells(memberPage, 'datasets'))[0].slice(0, 2), ['Private dataset', priv.shortname]);
      await openTab(memberPage, 'Annotations');
      await waitRows(memberPage, 'annotations', 3);
      assert.deepEqual((await cells(memberPage, 'annotations'))[0].slice(0, 3), ['Private dataset', priv.shortname, '1']);
    } finally {
      await H.closeContext(memberContext);
    }
  }).timeout(U.mediumTimeout);

  it('shows a short line in an empty tab', async () => {
    await page.goto(U.url(`/user/${nobody}`), { waitUntil: 'load' });
    await openTab(page, 'Datasets');
    await page.waitForSelector('#noDatasets', { timeout: U.mediumTimeout });
    assert.equal(await page.$eval('#noDatasets', (p) => p.textContent.trim()), 'No datasets yet.');
    assert.isNull(await page.$('#datasets'));
    await openTab(page, 'Annotations');
    await page.waitForSelector('#noAnnotations', { timeout: U.mediumTimeout });
    assert.equal(await page.$eval('#noAnnotations', (p) => p.textContent.trim()), 'No annotations yet.');
  }).timeout(U.mediumTimeout);
});
