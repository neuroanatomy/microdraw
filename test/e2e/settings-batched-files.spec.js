'use strict';

/*
  T002 3.1: the settings page loads the project's files in batches of 100 from
  /project/json/:p/files, as BrainBox's does. The "Files" heading shows the
  progress, the files section is dimmed until they are all in, and a save
  says how many files were received. A batch that fails is tried again after
  500 ms then 1000 ms; if it still fails, the heading shows the error and a
  Retry button that resumes from where it stopped.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-batched-owner', password: 'e2e-batched-owner-password' };
const SHORTNAME = 'e2ebatchedfiles';
const EMPTY = 'e2ebatchedempty';
const NFILES = 250;
const FILES = Array.from({ length: NFILES }, (_v, i) => ({ source: `http://batched.localhost/${i}.dzi`, name: `file ${String(i).padStart(3, '0')}` }));

const project = (shortname, files) => ({
  name: 'Batched files',
  shortname,
  url: '',
  created: '2026-11-14T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [{ username: 'anyone', userID: 'anyone', access: { collaborators: 'view', annotations: 'view', files: 'view' } }]
  },
  files: { list: files.map((f) => ({ ...f })) },
  annotations: { list: [] }
});

const isFilesRequest = (reqUrl) => reqUrl.includes(`/project/json/${SHORTNAME}/files`) || reqUrl.includes(`/project/json/${EMPTY}/files`);
const startOf = (reqUrl) => Number(new URL(reqUrl).searchParams.get('start'));
const serverError = { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) };

const filesHeading = (page) => page.evaluate(() => {
  const table = document.querySelector('#files');
  const section = (table.closest('.nwl-resize-wrap') || table).parentElement;

  return section.querySelector('h2').textContent.replace(/\s+/gu, ' ').trim();
});
const filesDimmed = (page) => page.evaluate(() => {
  const table = document.querySelector('#files');

  return (table.closest('.nwl-resize-wrap') || table).parentElement.classList.contains('filesLoading');
});
// each row of the files table: its source (a contenteditable span) and its name (an input)
const fileRows = (page) => page.$$eval('#files tbody tr', (trs) => trs.map((tr) => ({ source: tr.cells[0].textContent.trim(), name: tr.querySelector('input').value })));
const waitForAllFiles = (page, n) => page.waitForFunction((count) => document.querySelectorAll('#files tbody tr').length === count &&
  !document.querySelector('.filesLoading') && !document.querySelector('.filesStatus'), { timeout: U.shortTimeout }, n);

// eslint-disable-next-line max-statements
describe('Settings page: files loaded in batches (T002 3.1)', () => {
  let context;
  let page;
  let requests;
  let respond;

  before(async () => {
    await Promise.all([U.removeProject(SHORTNAME), U.removeProject(EMPTY)]);
    await U.insertProject([project(SHORTNAME, FILES), project(EMPTY, [])]);
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (!isFilesRequest(req.url())) {
        req.continue();

        return;
      }
      requests.push(req.url());
      // respond(req): an answer, 'hold' (it then answers the request itself), or null to let it through
      const answer = respond(req);
      if (answer === 'hold') { return; }
      if (answer) { req.respond(answer); } else { req.continue(); }
    });
  });

  beforeEach(() => {
    requests = [];
    respond = () => null;
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all([U.removeProject(SHORTNAME), U.removeProject(EMPTY)]);
      await U.removeLocalUser(owner.username);
    }
  });

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('shows the progress, then all the files in order, received in 3 batches', async () => {
    // the second batch waits until the progress has been read
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    respond = (req) => {
      if (startOf(req.url()) !== 100) { return null; }
      released.then(() => req.continue());

      return 'hold';
    };
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#files tbody tr').length === 100, { timeout: U.shortTimeout });
    assert.equal(await filesHeading(page), 'Files (loading… 100 / 250)');
    assert.isTrue(await filesDimmed(page), 'the files are dimmed while loading');
    release();
    await waitForAllFiles(page, NFILES);
    assert.equal(await filesHeading(page), 'Files');
    assert.isFalse(await filesDimmed(page));
    assert.deepEqual(await fileRows(page), FILES);
    assert.deepEqual(requests.map(startOf), [0, 100, 200]);
    assert.isTrue(requests.every((r) => r.includes('length=100') && r.includes('names=true')));
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('an edit saved after loading keeps the 250 files', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await waitForAllFiles(page, NFILES);
    // anyone's annotations access: view -> edit (columns: user name, name, collaborators, annotations, files)
    await page.click('#access tbody tr:nth-child(1) td:nth-child(4) button.edit');
    const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/project/json/${SHORTNAME}`), { timeout: U.shortTimeout });
    const [save] = await page.$$('xpath///button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    const res = await answer;
    const sent = JSON.parse(res.request().postData()).data;
    const body = await res.json();
    assert.equal(res.status(), 200, JSON.stringify(body));
    assert.notInclude(body.message, 'completely loaded');
    assert.deepEqual(sent.filesLoaded, { count: NFILES });
    const stored = await U.queryProject(SHORTNAME);
    assert.deepEqual(stored.files.list, FILES);
    assert.equal(stored.collaborators.list[0].access.annotations, 'edit', 'the edit is saved');
    assert.notProperty(stored, 'filesLoaded');
  }).timeout(U.mediumTimeout);

  it('a project without files sends no request and is not dimmed', async () => {
    await page.goto(U.url(`/project/${EMPTY}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('#files', { timeout: U.shortTimeout });
    await page.waitForFunction(() => document.querySelector('#numFiles'), { timeout: U.shortTimeout });
    assert.lengthOf(requests, 0);
    assert.isFalse(await filesDimmed(page));
    assert.equal(await filesHeading(page), 'Files');
  }).timeout(U.mediumTimeout);

  it('a batch answering 500 once is tried again, and the page completes', async () => {
    let failed = false;
    respond = (req) => {
      if (startOf(req.url()) === 100 && !failed) {
        failed = true;

        return serverError;
      }

      return null;
    };
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await waitForAllFiles(page, NFILES);
    assert.deepEqual(requests.map(startOf), [0, 100, 100, 200]);
    assert.deepEqual(await fileRows(page), FILES);
  }).timeout(U.mediumTimeout);

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('a batch failing 3 times shows the error and Retry, and Retry finishes the list', async () => {
    let failures = 0;
    respond = (req) => {
      if (startOf(req.url()) === 200 && failures < 3) {
        failures += 1;

        return serverError;
      }

      return null;
    };
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('.filesStatus button', { timeout: U.shortTimeout });
    assert.equal(await filesHeading(page), 'Files (could not load all the files: the server answered with status 500) Retry');
    assert.isTrue(await filesDimmed(page));
    assert.equal(await page.$$eval('#files tbody tr', (trs) => trs.length), 200);
    await page.click('.filesStatus button');
    await waitForAllFiles(page, NFILES);
    assert.deepEqual(requests.map(startOf), [0, 100, 200, 200, 200, 200]);
    assert.deepEqual(await fileRows(page), FILES);
  }).timeout(U.mediumTimeout);
});
