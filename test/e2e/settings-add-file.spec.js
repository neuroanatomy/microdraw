'use strict';

/*
  nwl-components 1.4.1: in the settings page, the URL cell of a file added
  with "+" is empty. Before 1.4.1 it was a 0 px wide inline span that could
  not be clicked. It must now have a size, show its "File URL" placeholder,
  be what is under the pointer at its centre, and take the focus when clicked.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-addfile-owner', password: 'e2e-addfile-owner-password' };
const SHORTNAME = 'e2eaddfile';

const project = () => ({
  name: 'Add file',
  shortname: SHORTNAME,
  url: '',
  created: '2026-10-16T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [{ username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'none', files: 'view' } }]
  },
  files: { list: [{ source: 'http://addfile.localhost/brain.dzi', name: 'brain' }] },
  annotations: { list: [] }
});

describe('Adding a file in the settings page (nwl-components 1.4.1)', () => {
  let context;
  let page;

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(project());
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(SHORTNAME);
      await U.removeLocalUser(owner.username);
    }
  });

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('lets the user click the empty URL cell of a file added with "+"', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('#files span[contenteditable]', { timeout: U.shortTimeout });
    await page.click('button[title="Add file"]');
    await page.waitForFunction(() => [...document.querySelectorAll('#files span[contenteditable]')].some((el) => el.textContent === ''), { timeout: U.shortTimeout });
    const cell = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#files span[contenteditable]')].find((s) => s.textContent === '');
      el.id = 'newFileURL';
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + (r.width / 2);
      const y = r.top + (r.height / 2);

      return { width: r.width, height: r.height, x, y, hit: document.elementFromPoint(x, y) === el, placeholder: getComputedStyle(el, '::before').content };
    });
    assert.isAbove(cell.width, 20, 'the empty URL cell has a width');
    assert.isAbove(cell.height, 10, 'the empty URL cell has a height');
    assert.isTrue(cell.hit, 'the empty URL cell is what is under the pointer at its centre');
    assert.strictEqual(cell.placeholder, '"File URL"');
    await page.mouse.click(cell.x, cell.y);
    assert.isTrue(await page.evaluate(() => document.activeElement && document.activeElement.id === 'newFileURL'), 'clicking the cell focuses it');
  }).timeout(U.mediumTimeout);
});
