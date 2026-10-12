'use strict';

/*
  M7: the project title in the settings page is a contenteditable span
  (nwl-components SettingsPage). With nwl-components 0.0.15 every key re-rendered
  the span and moved the caret to the start, so the title was written right to
  left. Fixed in nwl-components 1.3.19 (6134ba2), where the span is no longer
  re-rendered while it is edited.

  The reversal itself shows in recent Chrome (154), not in puppeteer 21's
  Chrome for Testing 116: there, setting textContent on an element whose only
  child is a text node edits that node in place and the caret survives. So the
  tests also check the cause: while the title is typed, no script may write the
  span's text (textContent, nodeValue or data). The browser's own typing does
  not go through these setters.

  The new-project page has no contenteditable title, only the short-name input:
  checked here because its handler moved from @keyup to @input in 1.3.x.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-m7-owner', password: 'e2e-m7-owner-password' };
const EXISTING = 'e2em7title';
const NEW = 'e2em7newtitle';
const NOLISTS = 'e2em7nolists';

const projectOf = (shortname, name) => {
  const project = U.createProjectWithPermission(shortname, {});
  project.name = name;
  project.owner = owner.username;
  project.collaborators.list = project.collaborators.list.filter((c) => c.username === 'anyone');

  return project;
};

// Count the script writes to the title's text (from now on, in this page).
const countTitleWrites = (page) => page.evaluate(() => {
  window.__titleWrites = 0;
  if (window.__titleWritesHooked) { return; }
  window.__titleWritesHooked = true;
  const inTitle = (node) => {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    return Boolean(el && el.closest('span.title[contenteditable]'));
  };
  [[Node.prototype, 'textContent'], [Node.prototype, 'nodeValue'], [CharacterData.prototype, 'data']].forEach(([proto, prop]) => {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, {
      ...desc,
      get: desc.get,
      set (value) {
        if (inTitle(this)) { window.__titleWrites += 1; }
        desc.set.call(this, value);
      }
    });
  });
});

// Type into the focused title; answers the number of script writes to its text.
const typeInTitle = async (page, text) => {
  await countTitleWrites(page);
  await page.keyboard.type(text);

  return page.evaluate(() => window.__titleWrites);
};

const titleOf = (page) => page.$eval('span.title[contenteditable]', (span) => span.textContent);

// Put the caret at the end of the title, as a click after the last letter would.
const focusTitleEnd = (page) => page.$eval('span.title[contenteditable]', (span) => {
  span.focus();
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
});

// eslint-disable-next-line max-statements -- setup, helpers and six tests
describe('Project title and settings pages (M7)', () => {
  let context;
  let page;

  const openSettings = async (shortname) => {
    await page.goto(U.url(`/project/${shortname}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('span.title[contenteditable]', { timeout: U.shortTimeout });
  };

  before(async () => {
    await Promise.all([EXISTING, NEW, NOLISTS].map((shortname) => U.removeProject(shortname)));
    await U.insertProject(projectOf(EXISTING, 'Initial Name'));
    const noLists = projectOf(NOLISTS, 'No lists');
    delete noLists.files;
    delete noLists.annotations.list;
    await U.insertProject(noLists);
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
  });

  after(async () => {
    await context.close();
    await Promise.all([EXISTING, NEW, NOLISTS].map((shortname) => U.removeProject(shortname)));
    await U.removeLocalUser(owner.username);
  });

  it('the settings page shows the existing project name', async () => {
    await openSettings(EXISTING);
    assert.equal(await titleOf(page), 'Initial Name');
  }).timeout(U.mediumTimeout);

  // nwl-components 1.3.19 adds an "Embed Project" button with no option to
  // hide it; microdraw has no embed route, so projectSettings-style.css hides it.
  it('the settings page does not show the Embed Project button', async () => {
    await openSettings(EXISTING);
    const buttons = await page.$$eval('.description .actions button', (bs) => bs
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.textContent.trim()));
    assert.deepEqual(buttons, ['Save Changes', 'Delete Project', 'Go to Project']);
  }).timeout(U.mediumTimeout);

  it('typing in an empty title writes left to right', async () => {
    await openSettings(NEW);
    assert.equal(await titleOf(page), '');
    await focusTitleEnd(page);
    const writes = await typeInTitle(page, 'Hello');
    assert.equal(await titleOf(page), 'Hello');
    assert.equal(writes, 0, 'the page rewrote the title while it was typed');
  }).timeout(U.mediumTimeout);

  it('typing after an existing name appends left to right, and Save stores it', async () => {
    await openSettings(EXISTING);
    await focusTitleEnd(page);
    const writes = await typeInTitle(page, ' abc');
    assert.equal(await titleOf(page), 'Initial Name abc');
    assert.equal(writes, 0, 'the page rewrote the title while it was typed');

    const [save] = await page.$x('//button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    await page.waitForFunction(
      () => document.querySelector('#saveFeedback').textContent.trim() !== '',
      { polling: 50, timeout: U.shortTimeout }
    );
    assert.equal((await U.queryProject(EXISTING)).name, 'Initial Name abc');
  }).timeout(U.mediumTimeout);

  // nwl-components 1.3.x crashes on a project without files.list
  // (ProjectService.transformProjectFiles): the page fills in the lists.
  it('the settings page opens a project saved without files or annotation lists', async () => {
    await openSettings(NOLISTS);
    await page.waitForSelector('#numFiles', { timeout: U.shortTimeout });
    assert.equal(await page.$eval('#numFiles', (el) => el.textContent), '0');
    // an empty annotation list gets one placeholder row (as in 0.0.15)
    assert.equal(await page.$eval('#numAnnotations', (el) => el.textContent), '1');
    assert.equal(await titleOf(page), 'No lists');
  }).timeout(U.mediumTimeout);

  it('the new-project page checks the short name as it is typed', async () => {
    await page.goto(U.url('/project/new'), { waitUntil: 'load' });
    await page.waitForSelector('input.input', { timeout: U.shortTimeout });
    const warnings = () => page.$$eval('.warning', (divs) => divs
      .filter((div) => div.style.display !== 'none')
      .map((div) => div.textContent.replace(/\s+/g, ' ').trim()));

    await page.type('input.input', 'not valid');
    await page.waitForFunction(() => [...document.querySelectorAll('.warning')]
      .some((div) => div.style.display !== 'none'), { polling: 50, timeout: U.shortTimeout });
    assert.deepEqual(await warnings(), ['This name is not allowed. Project short names can only contain letters and numbers']);

    await page.$eval('input.input', (input) => { input.select(); });
    await page.keyboard.type(EXISTING);
    // the existence check is debounced (250 ms)
    await page.waitForFunction(() => [...document.querySelectorAll('.warning')]
      .some((div) => div.style.display !== 'none' && div.textContent.includes('already exists')), { polling: 50, timeout: U.shortTimeout });
    assert.deepEqual(await warnings(), [`The project ${EXISTING} already exists`]);
  }).timeout(U.mediumTimeout);
});
