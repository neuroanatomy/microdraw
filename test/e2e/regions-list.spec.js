/* global Microdraw, paper */
/* eslint-disable max-lines */
'use strict';

/*
  T002 3.5: the Regions list of the labels panel lists the regions of the
  current slice, top-most first; a row selects its region, moves it (drag the
  row, Alt+Up/Down) and deletes it (its only button), with one undo step each,
  through Microdraw.moveRegion and Microdraw.cmdDeleteSelected. It follows a
  load, a slice change, the canvas selection, the toolbar order tools, undo,
  and another user's save.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const project = U.createPublicAnnotationProject('e2eregionslist');
const other = { username: 'e2e-regions-other', password: 'e2e-regions-other-password' };
const dataURL = () => U.url(`/data?source=${SOURCE}&project=${project.shortname}&slice=0`);
const fileID = (slice) => `${SOURCE}&slice=${slice}`;

const BOLD = '<b>bold</b>';
const LONG_TEXT = 'A text annotation that is longer than forty characters, shortened';

const triangle = (uid, name, x, y) => ({
  uid,
  name,
  path: ['Path', { applyMatrix: true, segments: [[x, y], [x + 60, y], [x + 30, y + 60]], closed: true }]
});
// fillColor with its alpha: one stored without it ([1, 0, 0]) is read back
// as [1, 0, 0, 1], and its slice counts as changed as soon as it is loaded
const pointText = (uid, content) => ({
  uid,
  name: 'textAnnotation',
  path: ['PointText', { applyMatrix: false, matrix: [1, 0, 0, 1, 100, 100], content, fillColor: [1, 0, 0, 1], fontSize: 20 }]
});
const doc = (slice, annotation, order) => ({
  fileID: fileID(slice),
  user: other.username,
  project: project.shortname,
  Hash: 'e2e',
  annotation,
  ...(typeof order === 'number' ? { order } : {})
});

let context;
let page;
let agent;
const errors = [];

// in the page: the list's rows, the regions' uids (paint order) and the paper.js children
const state = () => page.evaluate(() => new Promise((resolve) => {
  // after the list's own animation frame
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const regions = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
    const rows = [...Microdraw.dom.querySelectorAll('#regions-table tbody tr')];
    resolve({
      rows: rows.map((tr) => tr.dataset.uid),
      names: rows.map((tr) => tr.querySelector('.region-name').textContent),
      selected: rows.filter((tr) => tr.getAttribute('aria-selected') === 'true').map((tr) => tr.dataset.uid),
      regions: regions.map((r) => r.uid),
      paperOk: regions.every((r, i) => r.path === paper.project.activeLayer.children[i]),
      undo: Microdraw.UndoStack.length,
      region: Microdraw.region && Microdraw.region.uid
    });
  }));
}));

// a handle on an element of the shadow root
const $ = (sel) => page.evaluateHandle((s) => Microdraw.dom.querySelector(s), sel);
const rowSel = (uid) => `#regions-table tr[data-uid="${uid}"]`;
const clickIn = async (uid, sel = '.region-name') => (await $(`${rowSel(uid)} ${sel}`)).click();
const undo = () => page.evaluate(() => Microdraw.cmdUndo());
// a row clicked, then Alt+key: the keyboard move (no move buttons, maintainer 2026-11-15)
const altMove = async (uid, key) => {
  await clickIn(uid);
  await page.keyboard.down('Alt');
  await page.keyboard.press(key);
  await page.keyboard.up('Alt');
};
const waitForRows = (n) => page.waitForFunction((count) => Microdraw.dom.querySelectorAll('#regions-table tbody tr').length === count, { polling: 50, timeout: U.shortTimeout }, n);

// eslint-disable-next-line max-statements -- one test per case
describe('The Regions list of the labels panel (T002 3.5)', () => {
  // eslint-disable-next-line max-statements -- the fixture, step by step
  before(async () => {
    await U.removeProject(project.shortname);
    await U.insertProject(project);
    await U.removeProjectAnnotations(project.shortname);
    // A slice loads its regions newest first (the {project: 1, _id: -1}
    // index): inserted c, b, a, they are painted a (bottom), b, c (top).
    await U.insertAnnotations([
      doc(0, triangle('c', BOLD, 400, 100)),
      doc(0, triangle('b', 'Region 2', 250, 100)),
      doc(0, triangle('a', 'Region 1', 100, 100)),
      // slice 1 mixes documents with an order (saved since T002 3.5) and
      // without (older): first those without, newest first, then by order
      doc(1, triangle('o1', 'Region 6', 400, 300), 1),
      doc(1, triangle('o0', 'Region 7', 300, 300), 0),
      doc(1, pointText('t', LONG_TEXT)),
      doc(1, triangle('d', 'Region 3', 100, 100))
    ]);
    agent = await U.logIn(other);
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewport({ width: U.width, height: U.height });
    await H.logIn(page);
    await H.openData(page, dataURL());
    await page.evaluate(() => window.ToolColor.color.click('select'));
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProjectAnnotations(project.shortname);
      await U.removeProject(project.shortname);
      await U.removeLocalUser(other.username);
    }
  });

  afterEach(() => {
    assert.deepEqual(errors, []);
  });

  it('lists the regions loaded, top-most first, names as text', async () => {
    const s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c'], 'paint order as loaded');
    assert.deepEqual(s.rows, ['c', 'b', 'a']);
    assert.deepEqual(s.names, [BOLD, 'Region 2', 'Region 1']);
    assert.isFalse(await page.evaluate((sel) => Boolean(Microdraw.dom.querySelector(sel)), `${rowSel('c')} .region-name b`), 'no <b> element');
    assert.deepEqual(s.selected, []);
    // accessible: a labelled table, named buttons: the eye and delete (maintainer, 2026-11-15)
    assert.equal(await page.evaluate(() => Microdraw.dom.querySelector('#regions-table').getAttribute('aria-labelledby')), 'regions-heading');
    assert.deepEqual(
      await page.evaluate((sel) => [...Microdraw.dom.querySelectorAll(`${sel} button`)].map((b) => b.getAttribute('aria-label')), rowSel('b')),
      ['Hide', 'Delete']
    );
  }).timeout(U.longTimeout);

  it('a row selects its region, and a selection on the canvas selects its row', async () => {
    await clickIn('b');
    let s = await state();
    assert.equal(s.region, 'b');
    assert.deepEqual(s.selected, ['b']);
    assert.isTrue(await page.evaluate(() => Microdraw.region.path.selected));

    // the select tool, pressed on region a's centre
    await page.evaluate(() => {
      const [a] = Microdraw.ImageInfo[Microdraw.currentImage].Regions;
      const p = paper.view.projectToView(a.path.bounds.center);
      Microdraw.selectedTool = 'select';
      Microdraw.mouseDown(p.x, p.y);
      Microdraw.mouseUp();
    });
    s = await state();
    assert.equal(s.region, 'a');
    assert.deepEqual(s.selected, ['a']);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one test, step by step
  it('moves change the canvas order and the list, one undo step each', async () => {
    const before = await state();
    await altMove('a', 'ArrowUp');
    let s = await state();
    assert.deepEqual(s.regions, ['b', 'a', 'c']);
    assert.deepEqual(s.rows, ['c', 'a', 'b']);
    assert.isTrue(s.paperOk);
    assert.equal(s.undo, before.undo + 1);
    assert.isTrue(await page.evaluate(() => Microdraw.sectionChanges(Microdraw.ImageInfo[Microdraw.currentImage]) !== null), 'the slice is marked changed');

    await altMove('c', 'ArrowDown');
    s = await state();
    assert.deepEqual(s.regions, ['b', 'c', 'a']);
    assert.deepEqual(s.rows, ['a', 'c', 'b']);
    assert.isTrue(s.paperOk);

    await undo();
    await undo();
    s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c']);
    assert.deepEqual(s.rows, ['c', 'b', 'a']);
    assert.isTrue(s.paperOk);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one test, step by step
  it('Alt+Up and Alt+Down move the focused row', async () => {
    await clickIn('b');
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    let s = await state();
    assert.deepEqual(s.regions, ['a', 'c', 'b']);
    assert.deepEqual(s.rows, ['b', 'c', 'a']);
    assert.isTrue(s.paperOk);
    await undo();
    s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c']);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one test, step by step
  it('the toolbar order tools have one undo step and update the list', async () => {
    const before = await state();
    await page.evaluate(() => {
      Microdraw.selectRegion(Microdraw.ImageInfo[Microdraw.currentImage].Regions[0]);
      Microdraw.tools.front.click();
    });
    let s = await state();
    assert.deepEqual(s.regions, ['b', 'c', 'a']);
    assert.deepEqual(s.rows, ['a', 'c', 'b']);
    assert.equal(s.undo, before.undo + 1);
    await undo();
    s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c']);
    assert.deepEqual(s.rows, ['c', 'b', 'a']);
    await H.waitForTools(page);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one test, step by step
  it('a row dragged by its name above the top row becomes the top-most', async () => {
    const handle = await (await $(`${rowSel('a')} .region-name`)).boundingBox();
    const top = await (await $(rowSel('c'))).boundingBox();
    await page.mouse.move(handle.x + (handle.width / 2), handle.y + (handle.height / 2));
    await page.mouse.down();
    await page.mouse.move(handle.x + (handle.width / 2), top.y + (top.height / 2), { steps: 4 });
    await page.mouse.move(handle.x + (handle.width / 2), top.y + 2, { steps: 2 });
    await page.mouse.up();
    let s = await state();
    assert.deepEqual(s.regions, ['b', 'c', 'a']);
    assert.deepEqual(s.rows, ['a', 'c', 'b']);
    assert.isTrue(s.paperOk);
    await undo();
    s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c']);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one test, step by step
  it('the eye hides and shows a region on this page only: no edit, no undo step (2026-11-15)', async () => {
    const start = await state();
    const shown = (uid) => page.evaluate((u) => Microdraw.ImageInfo[Microdraw.currentImage].Regions.find((r) => r.uid === u).path.opacity, uid);
    const eye = (uid) => page.evaluate((sel) => {
      const b = Microdraw.dom.querySelector(`${sel} .region-eye`);

      return { label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') };
    }, rowSel(uid));
    // what a save would send: the same before and after (a selection from an
    // earlier test may already count as a change, so compare, don't expect none)
    const hash = () => page.evaluate(() => Microdraw.sectionHash(Microdraw.ImageInfo[Microdraw.currentImage]));
    const before = await hash();
    assert.deepEqual(await eye('b'), { label: 'Hide', pressed: 'false' });

    await clickIn('b', '.region-eye');
    await state();
    assert.equal(await shown('b'), 0);
    assert.equal(await shown('a'), 1);
    assert.deepEqual(await eye('b'), { label: 'Show', pressed: 'true' });
    assert.equal(await hash(), before, 'hiding is no edit');
    assert.equal((await state()).undo, start.undo, 'no undo step');

    // its label hidden then shown again: the region stays hidden by its eye
    await page.evaluate(() => {
      const panel = Microdraw.dom.querySelector('#labelset-panel');
      const b = Microdraw.ImageInfo[Microdraw.currentImage].Regions.find((r) => r.uid === 'b');
      const i = Microdraw.ontology.labels.findIndex((l) => l.name === b.name);
      const display = panel.querySelectorAll('#label-list .label-display')[i];
      display.click();
      display.click();
    });
    assert.equal(await shown('b'), 0);

    await clickIn('b', '.region-eye');
    await state();
    assert.equal(await shown('b'), 1);
    assert.deepEqual(await eye('b'), { label: 'Hide', pressed: 'false' });
    assert.equal(await hash(), before);
  }).timeout(U.longTimeout);

  it('the swatch sits inside its cell, and the panel header stays while the panel scrolls (2026-11-15)', async () => {
    // eslint-disable-next-line max-statements -- measures, then puts the scroll back
    const r = await page.evaluate((sel) => {
      const panel = Microdraw.dom.querySelector('#labelset-panel');
      const td = Microdraw.dom.querySelector(`${sel} .region-swatch-cell`);
      const sw = td.querySelector('.region-swatch');
      const [c, s] = [td.getBoundingClientRect(), sw.getBoundingClientRect()];
      const border = getComputedStyle(td).borderTopWidth;
      const { scrollTop } = panel;
      // a short panel, so that it scrolls
      panel.style.height = '150px';
      panel.scrollTop = panel.scrollHeight;
      const scrolled = panel.scrollTop > 0;
      const header = panel.querySelector('#labelset-header').getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.scrollTop = scrollTop;
      panel.style.height = '';

      return { inside: s.left >= c.left && s.right <= c.right && s.top >= c.top && s.bottom <= c.bottom, border, scrolled, header };
    }, rowSel('a'));
    assert.isTrue(r.inside, 'swatch inside its cell');
    assert.equal(r.border, '0px', 'no border of the old .region-color');
    assert.isTrue(r.scrolled, 'the short panel scrolls');
    assert.isAtMost(Math.abs(r.header), 2, 'header at the top of the scrolled panel');
  }).timeout(U.longTimeout);

  it('delete removes the region, and undo brings it back', async () => {
    await clickIn('b', '.region-delete');
    let s = await state();
    assert.deepEqual(s.regions, ['a', 'c']);
    assert.deepEqual(s.rows, ['c', 'a']);
    assert.isNull(s.region);
    assert.include(await page.evaluate(() => Microdraw.ImageInfo[Microdraw.currentImage].RegionsToRemove), 'b');
    await undo();
    s = await state();
    assert.deepEqual(s.regions, ['a', 'b', 'c']);
    assert.deepEqual(s.rows, ['c', 'b', 'a']);
  }).timeout(U.longTimeout);

  it('a label chosen for the selected region renames its row', async () => {
    await clickIn('a');
    // choosing a label closes the panel
    await page.evaluate(() => Microdraw.dom.querySelectorAll('#label-list .label-color')[4].click());
    await page.evaluate(() => window.ToolColor.color.click('select'));
    const s = await state();
    assert.deepEqual(s.names, [BOLD, 'Region 2', 'Region 5']);
  }).timeout(U.longTimeout);

  it('the order survives a save and a reload (T002 3.5)', async () => {
    await altMove('a', 'ArrowUp');
    assert.deepEqual((await state()).regions, ['b', 'a', 'c']);
    await H.waitForSave(page, () => page.evaluate(() => Microdraw.tools.save.click('select')));
    await H.openData(page, dataURL());
    await page.evaluate(() => window.ToolColor.color.click('select'));
    const s = await state();
    assert.deepEqual(s.regions, ['b', 'a', 'c']);
    assert.deepEqual(s.rows, ['c', 'a', 'b']);
    const docs = await U.findAnnotations({ project: project.shortname, fileID: fileID(0) });
    assert.deepEqual(Object.fromEntries(docs.map((d) => [d.annotation.uid, d.order])), { b: 0, a: 1, c: 2 });
  }).timeout(U.longTimeout);

  it("another user's reorder shows in the list", async () => {
    // the viewer's copy is clean: B saves the same regions, c to the bottom
    const docs = await U.findAnnotations({ project: project.shortname, fileID: fileID(0) });
    const regions = ['c', 'b', 'a'].map((uid) => docs.find((d) => d.annotation.uid === uid).annotation);
    const res = await agent.post('/api').send({
      action: 'save',
      source: SOURCE,
      slice: '0',
      project: project.shortname,
      Hash: 'e2eregions',
      annotation: JSON.stringify({ Regions: regions.map((r, order) => ({ ...r, order })), RegionsToRemove: [] })
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await page.waitForFunction(() => Microdraw.ImageInfo[Microdraw.currentImage].Regions.map((r) => r.uid).join() === 'c,b,a', { polling: 50, timeout: U.shortTimeout });
    assert.deepEqual((await state()).rows, ['a', 'b', 'c']);
  }).timeout(U.longTimeout);

  it("a slice change shows that slice's regions; a text annotation shows its text, shortened", async () => {
    await page.evaluate(() => Microdraw.loadNextImage());
    await H.waitForMicrodraw(page, 1);
    const s = await state();
    // painted d, t (no order, newest first), then o0, o1 (by order)
    assert.deepEqual(s.regions, ['d', 't', 'o0', 'o1']);
    assert.deepEqual(s.rows, ['o1', 'o0', 't', 'd']);
    const text = await page.evaluate((sel) => {
      const td = Microdraw.dom.querySelector(`${sel} .region-name`);

      return { marker: td.querySelector('.region-text-marker').textContent, text: td.querySelector('.region-text').textContent };
    }, rowSel('t'));
    assert.equal(text.marker, 'T');
    assert.equal(text.text, `${LONG_TEXT.slice(0, 39)}…`);
  }).timeout(U.longTimeout);

  it("another user's save of the slice shows in the list", async () => {
    const res = await agent.post('/api').send({
      action: 'save',
      source: SOURCE,
      slice: '1',
      project: project.shortname,
      Hash: 'e2eregions',
      annotation: JSON.stringify({ Regions: [triangle('e', 'Region 4', 300, 300)], RegionsToRemove: [] })
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await waitForRows(5);
    // saved without order, the newest: at the bottom
    assert.deepEqual((await state()).rows, ['o1', 'o0', 't', 'd', 'e']);
  }).timeout(U.longTimeout);
});
