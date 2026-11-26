/* global Microdraw */
/* eslint-disable max-lines */
'use strict';

/*
  T002 3.2: the viewer uses the label set of the project's first vectorial
  layer (its `values`: a file of app/public/labels/, or a label set's name),
  and 10 regions without a project, without a vectorial layer, or with a
  `values` that is not a known label set (one console.warn). The settings
  menu of a vectorial layer lists the real label sets, and a stored value
  that is not one of them ('Set 1', from the old stub) is shown and saved as
  stored.

  T002 3.5: app/public/labels/ holds 10regions.json and 20regions.json, 10
  regions first. The viewer tests also use a test fixture
  (fixtures/e2e3regions.json), served by request interception along with a
  /api/getLabelsets answer that lists it; 20regions.json is the real file.
  The stored values of the old settings stub ('Set I', 'set1.json', empty)
  load 10 regions; a new vectorial layer gets 10 regions in the settings.
*/
const fs = require('fs');
const path = require('path');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const E2E_SET = fs.readFileSync(path.join(__dirname, 'fixtures/e2e3regions.json'), 'utf8');
const LISTED = [
  { name: '10 regions', source: '10regions.json' },
  { name: '20 regions', source: '20regions.json' },
  { name: 'E2E 3 regions', source: 'e2e3regions.json' }
];

const owner = { username: 'e2e-labelsets-owner', password: 'e2e-labelsets-owner-password' };
const vectorial = (values, name = 'regions') => ({ type: 'vectorial', name, values, display: true });
const text = { type: 'text', name: 'notes', values: '', display: true };

const withLayers = (shortname, layers) => {
  const p = U.createPublicAnnotationProject(shortname);
  p.owner = owner.username;
  p.annotations = { list: layers };

  return p;
};
const projects = {
  tenRegions: withLayers('e2elabelsten', [text, vectorial('10regions.json')]),
  second: withLayers('e2elabelssecond', [text, vectorial('e2e3regions.json'), vectorial('10regions.json', 'other')]),
  byName: withLayers('e2elabelsbyname', [vectorial('E2E 3 regions')]),
  unknown: withLayers('e2elabelsunknown', [vectorial('Set 1')]),
  twenty: withLayers('e2elabelstwenty', [text, vectorial('20regions.json')]),
  stubSetI: withLayers('e2elabelsseti', [vectorial('Set I')]),
  stubFile: withLayers('e2elabelsset1', [vectorial('set1.json')]),
  stubEmpty: withLayers('e2elabelsempty', [vectorial('')]),
  noVectorial: withLayers('e2elabelsnovect', [text]),
  settings: withLayers('e2elabelssettings', [vectorial('10regions.json'), vectorial('Set 1', 'legacy')])
};
const shortnames = Object.values(projects).map((p) => p.shortname);

const dataURL = (shortname) => U.url(`/data?source=${SOURCE}${shortname ? `&project=${shortname}` : ''}&slice=0`);

describe('Label sets in the viewer and the settings (T002 3.2)', () => {
  let context;
  let page;
  const warnings = [];
  const errors = [];
  const asked = [];

  before(async () => {
    await Promise.all(shortnames.map((s) => U.removeProject(s)));
    await U.insertProject(Object.values(projects));
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    // the viewer's own warnings (OpenSeadragon, canvas) are not about label sets
    page.on('console', (msg) => { if (msg.type() === 'warn' && msg.text().includes('label set')) { warnings.push(msg.text()); } });
    page.on('pageerror', (err) => errors.push(err.message));
  });

  beforeEach(() => {
    warnings.length = 0;
    errors.length = 0;
    asked.length = 0;
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await Promise.all(shortnames.map((s) => U.removeProject(s)));
      await U.removeLocalUser(owner.username);
    }
  });

  // eslint-disable-next-line max-statements -- one test per case
  describe('the viewer', () => {
    let failProjectJSON = false;
    const onRequest = (req) => {
      const { pathname } = new URL(req.url());
      if (pathname === '/api/getLabelsets' || pathname.startsWith('/labels/') || pathname.startsWith('/project/json/')) {
        asked.push(pathname);
      }
      if (failProjectJSON && pathname.startsWith('/project/json/')) {
        req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
      } else if (pathname === '/api/getLabelsets') {
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(LISTED) });
      } else if (pathname === '/labels/e2e3regions.json') {
        req.respond({ status: 200, contentType: 'application/json', body: E2E_SET });
      } else {
        req.continue();
      }
    };
    before(async () => {
      await page.setRequestInterception(true);
      page.on('request', onRequest);
    });
    after(async () => {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    });

    // open the viewer and wait for the label set to be `name`; answer the
    // label panel's title and the number of labels
    const openAndWaitFor = async (shortname, name) => {
      await H.openData(page, dataURL(shortname));
      await page.waitForFunction((n) => Microdraw.ontology && Microdraw.ontology.name === n, { polling: 50, timeout: U.shortTimeout }, name);

      return page.evaluate(() => {
        window.ToolColor.color.click('select');
        const panel = Microdraw.dom.querySelector('#labelset-panel');
        const title = panel.querySelector('span#labels-name').textContent;
        panel.querySelector('#labels-close').click();

        return { title, labels: Microdraw.ontology.labels.length };
      });
    };

    it('a project whose first vectorial layer is 10regions.json loads 10 regions', async () => {
      assert.deepEqual(await openAndWaitFor(projects.tenRegions.shortname, '10 regions'), { title: '10 regions', labels: 10 });
      assert.include(asked, '/labels/10regions.json');
      assert.deepEqual(warnings, []);
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    it('a project whose first vectorial layer is another label set loads that one, not the second layer\'s', async () => {
      assert.deepEqual(await openAndWaitFor(projects.second.shortname, 'E2E 3 regions'), { title: 'E2E 3 regions', labels: 3 });
      assert.notInclude(asked, '/labels/10regions.json');
      assert.deepEqual(warnings, []);
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    it('a layer that names a label set by its name loads it', async () => {
      assert.deepEqual(await openAndWaitFor(projects.byName.shortname, 'E2E 3 regions'), { title: 'E2E 3 regions', labels: 3 });
      assert.deepEqual(warnings, []);
    }).timeout(U.longTimeout);

    it('an unknown value (\'Set 1\') falls back to 10 regions, with one warning naming the project and the value', async () => {
      assert.deepEqual(await openAndWaitFor(projects.unknown.shortname, '10 regions'), { title: '10 regions', labels: 10 });
      assert.lengthOf(warnings, 1, warnings.join('\n'));
      assert.include(warnings[0], projects.unknown.shortname);
      assert.include(warnings[0], '"Set 1"');
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    it('a project whose first vectorial layer is 20regions.json shows 20 regions in the panel (T002 3.5)', async () => {
      assert.deepEqual(await openAndWaitFor(projects.twenty.shortname, '20 regions'), { title: '20 regions', labels: 20 });
      assert.include(asked, '/labels/20regions.json');
      const panel = await page.evaluate(() => {
        window.ToolColor.color.click('select');
        const rows = [...Microdraw.dom.querySelectorAll('#labelset-panel #label-list > div')];
        const names = rows.map((r) => r.querySelector('.label-name').textContent);
        const colors = rows.map((r) => r.querySelector('.label-color').style.backgroundColor);
        // choosing the 15th label: the next region is a Region 15
        rows[14].querySelector('.label-color').click();

        return { names, colors, index: Microdraw.currentLabelIndex, next: Microdraw.ontology.labels[Microdraw.currentLabelIndex].name };
      });
      assert.deepEqual(panel.names, Array.from({ length: 20 }, (_, i) => `Region ${i + 1}`));
      assert.lengthOf(new Set(panel.colors), 20);
      assert.deepInclude(panel, { index: 14, next: 'Region 15' });
      assert.equal(await page.evaluate(() => Microdraw.dom.querySelector('#color').style.backgroundColor), panel.colors[14]);
      assert.deepEqual(warnings, []);
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    it('with 20 regions, a hidden label hides its regions, and the opacity slider works', async () => {
      // eslint-disable-next-line max-statements -- one step after the other in the page
      const result = await page.evaluate(() => {
        const reg = Microdraw.newRegion({ name: 'Region 15', path: new window.paper.Path.Circle([200, 200], 20) });
        window.ToolColor.color.click('select');
        const panel = Microdraw.dom.querySelector('#labelset-panel');
        const display = panel.querySelectorAll('#label-list > div')[14].querySelector('.label-display');
        display.click();
        const hidden = { opacity: reg.path.opacity, visible: Microdraw.ontology.labels[14].visible };
        display.click();
        const shown = reg.path.opacity;
        const slider = panel.querySelector('#labels-opacity');
        slider.value = '0.4';
        slider.dispatchEvent(new Event('input'));
        const { opacity } = Microdraw.dom.querySelector('#paperjs-container').style;
        slider.value = '1';
        slider.dispatchEvent(new Event('input'));
        panel.querySelector('#labels-close').click();

        return { hidden, shown, opacity };
      });
      assert.deepEqual(result, { hidden: { opacity: 0, visible: false }, shown: 1, opacity: '0.4' });
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    for (const [key, values] of [['stubSetI', 'Set I'], ['stubFile', 'set1.json'], ['stubEmpty', '']]) {
      it(`a stored '${values}' (the old settings stub) shows 10 regions`, async () => {
        assert.deepEqual(await openAndWaitFor(projects[key].shortname, '10 regions'), { title: '10 regions', labels: 10 });
        assert.deepEqual(errors, []);
      }).timeout(U.longTimeout);
    }

    it('a project without a vectorial layer loads 10 regions, without a warning', async () => {
      assert.deepEqual(await openAndWaitFor(projects.noVectorial.shortname, '10 regions'), { title: '10 regions', labels: 10 });
      assert.notInclude(asked, '/api/getLabelsets');
      assert.deepEqual(warnings, []);
    }).timeout(U.longTimeout);

    it('without a project: 10 regions, and no project or label set list is asked for', async () => {
      assert.deepEqual(await openAndWaitFor(null, '10 regions'), { title: '10 regions', labels: 10 });
      assert.deepEqual(asked, ['/labels/10regions.json']);
      assert.deepEqual(warnings, []);
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);

    it('when the project\'s layers cannot be fetched, 10 regions, and the viewer works', async () => {
      failProjectJSON = true;
      try {
        // its first vectorial layer is the E2E set, not read
        assert.deepEqual(await openAndWaitFor(projects.second.shortname, '10 regions'), { title: '10 regions', labels: 10 });
      } finally {
        failProjectJSON = false;
      }
      assert.include(asked, `/project/json/${projects.second.shortname}`);
      assert.notInclude(asked, '/labels/e2e3regions.json');
      assert.deepEqual(errors, []);
    }).timeout(U.longTimeout);
  });

  describe('the settings page', () => {
    const layerRows = () => page.$$eval('#annotations tbody tr', (trs) => trs.map((tr) => {
      const select = tr.cells[2].querySelector('select');

      return {
        value: select.value,
        shown: select.selectedIndex >= 0 ? select.options[select.selectedIndex].textContent.trim() : null,
        options: [...select.options].map((o) => ({ name: o.textContent.trim(), source: o.value }))
      };
    }));

    before(async () => {
      await H.logIn(page, owner);
    });

    it('lists the real label sets, and shows a stored \'Set 1\' as stored', async () => {
      await page.goto(U.url(`/project/${projects.settings.shortname}/settings`), { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const selects = document.querySelectorAll('#annotations tbody tr select:not([multiple])');

        return document.querySelectorAll('#annotations tbody tr').length === 2 && selects.length === 4 &&
          [...document.querySelectorAll('#annotations tbody tr')].every((tr) => tr.cells[2].querySelector('select').options.length > 0);
      }, { polling: 50, timeout: U.shortTimeout });
      const rows = await layerRows();
      // the real list first (app/public/labels/), then the stored value that is not in it
      assert.deepEqual(rows[0].options, [
        { name: '10 regions', source: '10regions.json' },
        { name: '20 regions', source: '20regions.json' },
        { name: 'Set 1', source: 'Set 1' }
      ]);
      assert.deepInclude(rows[0], { value: '10regions.json', shown: '10 regions' });
      assert.deepInclude(rows[1], { value: 'Set 1', shown: 'Set 1' });
    }).timeout(U.longTimeout);

    it('a save keeps the stored \'Set 1\' unchanged', async () => {
      const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/project/json/${projects.settings.shortname}`), { timeout: U.shortTimeout });
      const [save] = await page.$$('xpath///button[contains(normalize-space(.), "Save Changes")]');
      await save.click();
      const res = await answer;
      assert.equal(res.status(), 200, JSON.stringify(await res.json()));
      const stored = await U.queryProject(projects.settings.shortname);
      assert.deepEqual(stored.annotations.list.map((a) => a.values), ['10regions.json', 'Set 1']);
    }).timeout(U.longTimeout);

    // eslint-disable-next-line max-statements -- one test, step by step
    it('a new vectorial layer gets 10 regions, stored (T002 3.5)', async () => {
      const [add] = await page.$$('xpath///button[@title="Add annotation"]');
      await add.click();
      await page.waitForFunction(() => document.querySelectorAll('#annotations tbody tr').length === 3, { polling: 50, timeout: U.shortTimeout });
      await page.type('#annotations tbody tr:nth-child(3) td:nth-child(1) input', 'new layer');
      await page.select('#annotations tbody tr:nth-child(3) td:nth-child(2) select', 'vectorial');
      await page.waitForFunction(() => Boolean(document.querySelector('#annotations tbody tr:nth-child(3) td:nth-child(3) select')), { polling: 50, timeout: U.shortTimeout });
      assert.deepInclude((await layerRows())[2], { value: '10regions.json', shown: '10 regions' });

      const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/project/json/${projects.settings.shortname}`), { timeout: U.shortTimeout });
      const [save] = await page.$$('xpath///button[contains(normalize-space(.), "Save Changes")]');
      await save.click();
      assert.equal((await answer).status(), 200);
      const stored = await U.queryProject(projects.settings.shortname);
      assert.deepEqual(stored.annotations.list.map((a) => [a.type, a.values]), [
        ['vectorial', '10regions.json'],
        ['vectorial', 'Set 1'],
        ['vectorial', '10regions.json']
      ]);
    }).timeout(U.longTimeout);

    // G1, nwl-components 3.7.2: defaultFetchLabelSets throws on an error
    // status (it returned the error body before). Either way the menus offer
    // only the stored values, and the page keeps working.
    // eslint-disable-next-line max-statements -- one test, step by step
    it('when the label set list answers 500, the menus offer the stored values', async () => {
      const onRequest = (req) => {
        if (new URL(req.url()).pathname === '/api/getLabelsets') {
          req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
        } else {
          req.continue();
        }
      };
      await page.setRequestInterception(true);
      page.on('request', onRequest);
      try {
        await page.goto(U.url(`/project/${projects.settings.shortname}/settings`), { waitUntil: 'load' });
        await page.waitForFunction(() => {
          const trs = [...document.querySelectorAll('#annotations tbody tr')];

          return trs.length === 3 && trs.every((tr) => tr.cells[2].querySelector('select') && tr.cells[2].querySelector('select').options.length > 0);
        }, { polling: 50, timeout: U.shortTimeout });
        const rows = await layerRows();
        assert.deepEqual(rows[0].options, [
          { name: '10regions.json', source: '10regions.json' },
          { name: 'Set 1', source: 'Set 1' }
        ]);
        assert.deepEqual(rows.map((r) => r.value), ['10regions.json', 'Set 1', '10regions.json']);
        assert.deepEqual(errors, []);
      } finally {
        page.off('request', onRequest);
        await page.setRequestInterception(false);
      }
    }).timeout(U.longTimeout);
  });
});
