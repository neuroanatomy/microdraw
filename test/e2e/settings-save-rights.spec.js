'use strict';

/*
  The save of the settings by per-list rights (2026-11-15): a collaborator
  with files view and annotations remove (the maintainer's rights in
  squirrelmonkey) adds a layer and sees the success message; a collaborator
  with only view rights sees why the save was refused, not "error".
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-saverights-owner', password: 'e2e-saverights-owner-password' };
const layerEditor = { username: 'e2e-saverights-layers', password: 'e2e-saverights-layers-password' };
const viewer = { username: 'e2e-saverights-viewer', password: 'e2e-saverights-viewer-password' };
const SHORTNAME = 'e2esaverights';

const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });
const row = (username, a) => ({ username, userID: username, name: username, access: a });

const project = {
  name: 'Save rights',
  shortname: SHORTNAME,
  url: '',
  created: '2026-11-15T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      row('anyone', access('none', 'none', 'none')),
      row(layerEditor.username, access('view', 'remove', 'remove')),
      row(viewer.username, access('view', 'view', 'view'))
    ]
  },
  files: { list: [{ source: 'http://saverights.localhost/brain.dzi', name: 'brain' }] },
  annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '10regions.json' }] }
};

describe('Settings saved by per-list rights (2026-11-15)', () => {
  let context;
  let page;

  const openSettings = async (user) => {
    await H.logIn(page, user);
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#annotations tbody tr').length === 1, { polling: 50, timeout: U.shortTimeout });
  };
  const addLayer = async (name) => {
    const [add] = await page.$$('xpath///button[@title="Add annotation"]');
    await add.click();
    await page.waitForFunction(() => document.querySelectorAll('#annotations tbody tr').length === 2, { polling: 50, timeout: U.shortTimeout });
    await page.type('#annotations tbody tr:nth-child(2) td:nth-child(1) input', name);
    await page.select('#annotations tbody tr:nth-child(2) td:nth-child(2) select', 'vectorial');
  };
  const saveAndReadFeedback = async () => {
    const [save] = await page.$$('xpath///button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    const feedback = await page.waitForFunction(
      () => document.querySelector('#saveFeedback').textContent.trim(),
      { polling: 50, timeout: U.shortTimeout }
    );

    return feedback.jsonValue();
  };

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(project);
    context = await H.newContext();
    page = await context.newPage();
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(SHORTNAME);
      await Promise.all([owner, layerEditor, viewer].map((u) => U.removeLocalUser(u.username)));
    }
  });

  it('files view, annotations remove: a layer added is saved, with the success message', async () => {
    await openSettings(layerEditor);
    await addLayer('Cortex');
    assert.equal(await saveAndReadFeedback(), 'Project settings updated.');
    const stored = await U.queryProject(SHORTNAME);
    assert.deepEqual(stored.annotations.list.map((a) => [a.name, a.type, a.values]), [
      ['Layer', 'vectorial', '10regions.json'],
      ['Cortex', 'vectorial', '10regions.json']
    ]);
  }).timeout(U.longTimeout);

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('view everywhere: the save is refused, and the page says why', async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(project);
    // a new browser context: no session of the first user
    await H.closeContext(context);
    context = await H.newContext();
    page = await context.newPage();
    await openSettings(viewer);
    await addLayer('Refused');
    const feedback = await saveAndReadFeedback();
    assert.notEqual(feedback, 'error');
    assert.match(feedback, /edit rights/);
    assert.deepEqual((await U.queryProject(SHORTNAME)).annotations.list.map((a) => a.name), ['Layer']);
  }).timeout(U.longTimeout);
});
