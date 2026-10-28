/*
  N2: the space between table columns, in the user, project, project settings
  and admin pages: in every table, each cell but the last of its row is
  followed by 1em, so that neighbouring columns ("Collaborators", "Owner"…) do
  not run together, and the last cell has no such space after it.
  - nwl-components' Table (user, settings and admin pages; SortableTh in the
    user page) spaces its own columns since nwl-components 1.5.1;
  - the plain tables (the project page's two tables, and the table of
    nwl-components' ImportFilesDialog in the settings page) are spaced by
    app/public/css/shared-style.css.
  Adapted from BrainBox test/integration/table-spacing.test.js (37a4b08).
  The gap is measured as BrainBox does: padding-right of a cell plus
  padding-left of the next one. A plain cell keeps the browser's 1px padding,
  hence the SLACK.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const SLACK = 2; // px: a plain cell's default 1px padding on either side
const owner = { username: 'e2e-n2-owner', password: 'e2e-n2-owner-password' };
const PROJECT = 'e2en2tables';
const SOURCE = 'http://n2-table-spacing.localhost/brain.dzi';

const project = () => {
  const p = U.createProjectWithPermission(PROJECT, { files: 'view', annotations: 'view' });
  p.name = 'Table spacing';
  p.owner = owner.username;
  p.files.list = [{ source: '/test_data/cat.json', name: 'cat' }];
  p.annotations.list = [
    { name: 'regions', type: 'vectorial', values: 'set1.json', display: true },
    { name: 'notes', type: 'text', values: '', display: true }
  ];

  return p;
};

// an orphan annotation, so that the admin page has a row
const orphan = {
  fileID: `${SOURCE}&slice=0`,
  user: owner.username,
  project: '',
  Hash: 'h',
  annotation: { name: 'n2', uid: 'e2e-n2-orphan', path: ['Path', { segments: [[0, 0], [10, 10], [20, 0]], closed: true }] }
};

const PAGES = {
  user: { path: `/user/${owner.username}`, waitFor: '#projects tbody tr' },
  project: { path: `/project/${PROJECT}?source=/test_data/cat.json&project=${PROJECT}`, waitFor: '#projectFiles tbody tr' },
  settings: { path: `/project/${PROJECT}/settings`, waitFor: '#access tbody tr' },
  admin: { path: `/admin?source=${encodeURIComponent(SOURCE)}`, waitFor: '#orphan-list tr.orphan' }
};

/**
 * The spacing of the cells of the page's tables (those matching `tables`):
 * each cell but the last of its row must be followed by 1em (its font size),
 * and the last one by nothing.
 * @param {Object} page A puppeteer page
 * @param {string} tables CSS selector of the tables to check
 * @param {number} slack Tolerance in px
 * @returns {Promise<Object>} The badly spaced cells, as "table: left|right: gap", and the number of cells checked
 */
const badlySpacedCells = (page, tables, slack) => page.$$eval(tables, (elements, tolerance) => {
  const px = (cell, prop) => parseFloat(getComputedStyle(cell)[prop]);
  const cells = elements.flatMap((table) => [...table.querySelectorAll('tr')].flatMap((tr) => [...tr.cells].map((cell) => {
    const next = cell.nextElementSibling;
    const label = `${table.id || table.parentElement.id || table.parentElement.className}: ${cell.textContent.trim()}|${next ? next.textContent.trim() : '(last)'}`;
    const gap = next ? px(cell, 'paddingRight') + px(next, 'paddingLeft') : px(cell, 'paddingRight');
    const expected = next ? px(cell, 'fontSize') : 0;

    return { label, gap, expected };
  })));

  return {
    bad: cells.filter((c) => Math.abs(c.gap - c.expected) > tolerance).map((c) => `${c.label}: ${c.gap}px, expected ${c.expected}px`),
    checked: cells.length
  };
}, slack);

describe('Space between table columns (N2)', () => {
  let context;
  let page;
  let previousAdmins;

  const checkTables = async (tables = 'table') => {
    const { bad, checked } = await badlySpacedCells(page, tables, SLACK);
    assert.isAbove(checked, 0, 'no table cells found');
    assert.deepEqual(bad, []);
  };

  const checkPage = async ({ path: pagePath, waitFor }) => {
    await page.goto(U.url(pagePath), { waitUntil: 'load' });
    await page.waitForSelector(waitFor, { timeout: U.mediumTimeout });
    await checkTables();
  };

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([owner.username]);
    await U.removeProject(PROJECT);
    await U.insertProject(project());
    await U.removeAnnotations(SOURCE);
    await U.insertAnnotations([orphan]);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    await H.logIn(page, owner);
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    // DB cleanup in finally: a crashed browser must not skip it (M5f)
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(PROJECT);
      await U.removeAnnotations(SOURCE);
      await U.removeLocalUser(owner.username);
    }
  });

  Object.entries(PAGES).forEach(([name, p]) => {
    it(`leaves space between the columns in the ${name} page`, async () => {
      await checkPage(p);
    }).timeout(U.mediumTimeout);
  });

  it('leaves space between the columns of the settings page\'s import dialog', async () => {
    const csv = path.join(os.tmpdir(), 'e2e-n2-import.csv');
    await fs.promises.writeFile(csv, 'http://n2-table-spacing.localhost/a.dzi,a\nhttp://n2-table-spacing.localhost/b.dzi,b');
    try {
      await page.goto(U.url(PAGES.settings.path), { waitUntil: 'load' });
      await page.waitForSelector('button[title="Upload CSV"]', { timeout: U.mediumTimeout });
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: U.mediumTimeout }),
        page.click('button[title="Upload CSV"]')
      ]);
      await chooser.accept([csv]);
      await page.waitForSelector('.dialog table tr', { timeout: U.mediumTimeout });
      await checkTables('.dialog table');
    } finally {
      await fs.promises.rm(csv, { force: true });
    }
  }).timeout(U.mediumTimeout);
});
