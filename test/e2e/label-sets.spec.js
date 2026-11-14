/* global Microdraw */
'use strict';

/*
  T002 3.2: the viewer uses the label set of the project's first vectorial
  layer (its `values`: a file of app/public/labels/, or a label set's name),
  and 10 regions without a project, without a vectorial layer, or with a
  `values` that is not a known label set (one console.warn). The settings
  menu of a vectorial layer lists the real label sets, and a stored value
  that is not one of them ('Set 1', from the old stub) is shown and saved as
  stored.

  app/public/labels/ only holds 10regions.json: the second label set is a
  test fixture (fixtures/e2e3regions.json), served by request interception
  along with a /api/getLabelsets answer that lists it.
*/
const fs = require('fs');
const path = require('path');
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const SOURCE = '/test_data/cat.json';
const E2E_SET = fs.readFileSync(path.join(__dirname, 'fixtures/e2e3regions.json'), 'utf8');
const LISTED = [{ name: '10 regions', source: '10regions.json' }, { name: 'E2E 3 regions', source: 'e2e3regions.json' }];

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
      assert.deepEqual(rows[0].options, [{ name: '10 regions', source: '10regions.json' }, { name: 'Set 1', source: 'Set 1' }]);
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
  });
});
