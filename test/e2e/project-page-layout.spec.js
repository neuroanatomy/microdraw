'use strict';

const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

/*
  The project page's left pane (2026-10-28). Until cc86d15 ("project page
  rebuilt in Vue 3") each cell held an `<input>` with `width: 100%`, which
  clipped long text and let the columns shrink: dragging the resize handle
  left, the pane stopped only at the width of the table headers, 114 px at
  this viewport (measured on the current page with its cells put back as the
  old inputs). The rebuilt page wrote the cells as plain text, centred them,
  and the longest file URL then set the pane's smallest width.
  Now, as on BrainBox's project page: cells left-aligned, `#left` with
  `min-width: 0`, long cells clipped on one line with an ellipsis and their
  full text in a `title`.
*/
const CAT = '/test_data/cat.json';
const LONG = `${CAT}?long=${'abcdefghij'.repeat(15)}`;
const OLD_LIMIT = 114; // px, see above

const project = U.createProjectWithPermission('e2eprojectpagelayout', {});
project.collaborators.list[0].access.files = 'view';
project.collaborators.list[0].access.annotations = 'view';
project.files.list = [
  { source: CAT, name: 'cat' },
  { source: LONG, name: `a long file name ${'x'.repeat(80)}` },
  { source: '/test_data/not-there.json', name: '' }
];
project.annotations.list = [
  { type: 'vectorial', name: 'regions', values: `a long label set ${'y'.repeat(80)}`, display: true },
  { type: 'text', name: 'comment', values: null, display: true }
];
const pageURL = () => U.url(`/project/${project.shortname}?source=${encodeURIComponent(CAT)}&project=${project.shortname}`);
const CELLS = '#projectFiles tbody td, #vecAnnotations tbody td';

// Drag the handle to x = 0. The press is sent to the handle itself: before
// the fix it sat beyond the right edge of the window.
const dragHandleFarLeft = async (page) => {
  await page.$eval('#resizeButton', (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  const y = U.height / 2;
  await page.mouse.move(U.width - 10, y);
  await page.mouse.move(0, y, { steps: 20 });
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
};

describe('Project page: left-aligned cells, the left pane shrinks freely', function () {
  let context, page;
  const pageErrors = [];

  before(async function () {
    await U.insertProject({ ...project });
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  beforeEach(async function () {
    pageErrors.length = 0;
    await page.goto(pageURL(), { waitUntil: 'load' });
    await H.settleFrames(page);
  });

  after(async function () {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  it('cells are left-aligned, and an empty one still says "Empty"', async function () {
    const cells = await page.$$eval(CELLS, (tds) => tds.map((td) => ({
      align: getComputedStyle(td).textAlign,
      placeholder: getComputedStyle(td, '::before').content
    })));
    assert.isAbove(cells.length, 0);
    cells.forEach((c) => assert.oneOf(c.align, ['left', 'start']));
    assert.include(cells.map((c) => c.placeholder), '"Empty"');
  }).timeout(U.shortTimeout);

  it('the left pane fits in the window, and long cells are clipped on one line with their text in a title', async function () {
    const state = await page.evaluate(() => {
      const pane = document.querySelector('#projectFiles');
      const paneRight = document.querySelector('#left').getBoundingClientRect().right;
      const cells = [...document.querySelectorAll('#projectFiles tbody td, #vecAnnotations tbody td')];

      return {
        leftWidth: document.querySelector('#left').getBoundingClientRect().width,
        paneScroll: [pane.scrollWidth, pane.clientWidth],
        outside: cells.filter((td) => td.getBoundingClientRect().right > paneRight + 0.5).length,
        cells: cells.map((td) => ({
          text: td.textContent,
          title: td.getAttribute('title'),
          whiteSpace: getComputedStyle(td).whiteSpace,
          textOverflow: getComputedStyle(td).textOverflow
        }))
      };
    });
    assert.isBelow(state.leftWidth, U.width, 'the left pane is wider than the window');
    assert.isAtMost(state.paneScroll[0], state.paneScroll[1], 'the files table is wider than its pane');
    assert.equal(state.outside, 0, 'a cell goes past the pane');
    const long = state.cells.filter((c) => c.text.length > 50);
    assert.lengthOf(long, 3);
    long.forEach((c) => {
      assert.equal(c.title, c.text, 'no title with the full text');
      assert.equal(c.whiteSpace, 'nowrap');
      assert.equal(c.textOverflow, 'ellipsis');
    });
  }).timeout(U.shortTimeout);

  it('dragging the handle far left makes the pane as narrow as the old page allowed', async function () {
    await dragHandleFarLeft(page);
    const state = await page.evaluate((url) => {
      const span = document.createElement('span');
      span.textContent = url;
      span.style.whiteSpace = 'nowrap';
      document.querySelector('#projectFiles td').appendChild(span);
      const urlWidth = span.getBoundingClientRect().width;
      span.remove();

      return {
        left: document.querySelector('#left').getBoundingClientRect().width,
        urlWidth
      };
    }, LONG);
    assert.isAtMost(state.left, OLD_LIMIT);
    assert.isBelow(state.left, state.urlWidth);
    // at the old page's smallest width, both tables still fit in their pane
    const fits = await page.evaluate((limit) => {
      document.querySelector('#left').style.flexBasis = `${limit}px`;

      return ['#projectFiles', '#annotations'].map((s) => {
        const el = document.querySelector(s);

        return el.scrollWidth <= el.clientWidth;
      });
    }, OLD_LIMIT);
    assert.deepEqual(fits, [true, true], 'a table is wider than its pane');
    assert.deepEqual(pageErrors, []);
  }).timeout(U.shortTimeout);
});
