/* global Microdraw */
'use strict';

/*
  Choosing a label in the labels panel with no region selected, on a slice
  that has regions: the label becomes the one for the next region, and the
  panel closes. Before 2026-11-11 color.js read the uid of the selected
  region without checking there was one: "region is null", the panel stayed
  open and the label did not change (seen on production, AllenPrimates).
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const project = U.createPublicAnnotationProject('e2elabelselect');
const other = { username: 'e2e-label-other', password: 'e2e-label-other-password' };
const dataURL = () => U.url(`/data?source=${SOURCE}&project=${project.shortname}&slice=0`);

let context;
let page;
let agent;
const errors = [];

const region = (uid, x) => ({
  name: uid,
  uid,
  path: ['Path', { applyMatrix: true, segments: [[x, 300], [x + 100, 300], [x + 50, 400]], closed: true }]
});

// what another user's viewer sends (as fresh-slice.spec.js)
const otherSaves = async (Regions) => {
  const res = await agent.post('/api').send({
    action: 'save',
    source: SOURCE,
    slice: '0',
    project: project.shortname,
    Hash: 'e2elabel',
    annotation: JSON.stringify({ Regions, RegionsToRemove: [] })
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

// open the labels panel and click the colour of the label at `index`
const chooseLabel = (index) => page.evaluate((i) => {
  window.ToolColor.color.click('select');
  Microdraw.dom.querySelectorAll('#labelset-panel #label-list .label-color')[i].click();
}, index);

describe('Choosing a label with no region selected', () => {
  before(async () => {
    await U.removeProject(project.shortname);
    await U.insertProject(project);
    await U.removeProjectAnnotations(project.shortname);
    agent = await U.logIn(other);
    await otherSaves([region('labelfirst', 100)]);
  });

  before(async () => {
    context = await H.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewport({ width: U.width, height: U.height });
    await H.openData(page, dataURL());
    await page.waitForFunction(() => Microdraw.ImageInfo[0].Regions.length === 1, { polling: 50, timeout: U.shortTimeout });
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

  it('sets the label for the next region, closes the panel, and throws nothing', async () => {
    assert.isNull(await page.evaluate(() => Microdraw.region), 'no region selected');
    const labels = await page.evaluate(() => Microdraw.ontology.labels.length);
    assert.isAbove(labels, 1, 'the ontology has more than one label');

    await chooseLabel(1);

    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => Microdraw.currentLabelIndex), 1);
    assert.equal(await page.evaluate(() => Microdraw.dom.querySelector('#labelset-panel').style.display), 'none');
    // the region on the slice keeps its name
    assert.deepEqual(await page.evaluate(() => Microdraw.ImageInfo[0].Regions.map((r) => r.name)), ['labelfirst']);
  }).timeout(U.longTimeout);

  it('with a region selected, renames it to the label chosen', async () => {
    await page.evaluate(() => { [Microdraw.region] = Microdraw.ImageInfo[0].Regions; });
    const name = await page.evaluate(() => Microdraw.ontology.labels[2].name);

    await chooseLabel(2);

    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => Microdraw.ImageInfo[0].Regions.map((r) => r.name)), [name]);
  }).timeout(U.longTimeout);
});
