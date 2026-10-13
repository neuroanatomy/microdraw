'use strict';

/*
  N2: the space between table columns (app/public/css/shared-style.css, loaded
  by every page), in the user, project, project settings and admin pages: in
  every table, each cell but the last of its row is followed by some space, so
  that neighbouring columns ("Collaborators", "Owner"…) do not run together.
  Adapted from BrainBox test/integration/table-spacing.test.js (37a4b08).
  The gap is measured as BrainBox does: padding-right of a cell plus
  padding-left of the next one.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const MIN_GAP = 8; // px between the text of two neighbouring cells
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
 * The neighbouring cells of the page's tables with less than MIN_GAP pixels between them.
 * @param {Object} page A puppeteer page
 * @returns {Promise<Object>} The cramped pairs, as "left|right: gap", and the number of pairs checked
 */
const crampedCells = (page) => page.$$eval('table', (tables, minGap) => {
  const px = (cell, side) => parseFloat(getComputedStyle(cell)[`padding${side}`]);
  const pairs = tables.flatMap((table) => [...table.querySelectorAll('tr')].flatMap((tr) => [...tr.cells].slice(0, -1)
    .map((cell) => ({
      label: `${table.id || table.className}: ${cell.textContent.trim()}|${cell.nextElementSibling.textContent.trim()}`,
      gap: px(cell, 'Right') + px(cell.nextElementSibling, 'Left')
    }))));

  return {
    cramped: pairs.filter((p) => p.gap < minGap).map((p) => `${p.label}: ${p.gap}px`),
    checked: pairs.length
  };
}, MIN_GAP);

describe('Space between table columns (N2)', () => {
  let context;
  let page;
  let previousAdmins;

  const checkPage = async ({ path, waitFor }) => {
    await page.goto(U.url(path), { waitUntil: 'load' });
    await page.waitForSelector(waitFor, { timeout: U.mediumTimeout });
    const { cramped, checked } = await crampedCells(page);
    assert.isAbove(checked, 0, 'no table cells found');
    assert.deepEqual(cramped, []);
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
});
