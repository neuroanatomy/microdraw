'use strict';

/*
  M3a2: projects stored before M3 hold rows that M3a's validation refuses
  (an unnamed annotation, a file without source, a blank collaborator: 21 of
  76 production projects). Opened in the real nwl-components settings page
  and saved without any change, they must save, keeping the stored rows.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-m3a2-owner', password: 'e2e-m3a2-owner-password' };
const SHORTNAME = 'e2em3a2legacy';
const none = { collaborators: 'none', annotations: 'none', files: 'none' };

const legacyProject = () => ({
  name: 'M3a2 legacy rows',
  shortname: SHORTNAME,
  url: '',
  created: '2020-01-01T00:00:00.000Z',
  owner: owner.username,
  collaborators: {
    list: [
      { username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'none', files: 'view' } },
      { username: '', name: '', access: none }
    ]
  },
  files: {
    list: [
      'http://m3a2-legacy.localhost/plain-string.dzi',
      // stored as a string, not valid as a new source (a space): the page
      // sends it back as {source, name}, which must still count as stored
      'http://m3a2-legacy.localhost/with space.dzi',
      '',
      { source: '', name: 'no source' },
      { source: 'http://m3a2-legacy.localhost/object.dzi', name: 'object' }
    ]
  },
  annotations: {
    list: [
      { type: 'text', values: null, display: true },
      { type: 'vectorial', values: 'Set 1', display: true },
      { type: 'text', name: 'named', values: null, display: true }
    ]
  }
});

describe('Saving a project with legacy rows from the settings page (M3a2)', () => {
  let context;
  let page;

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(legacyProject());
    context = await H.newContext();
    page = await context.newPage();
    await H.logIn(page, owner);
  });

  after(async () => {
    await context.close();
    await U.removeProject(SHORTNAME);
    await U.removeLocalUser(owner.username);
  });

  // eslint-disable-next-line max-statements -- one UI flow, step by step
  it('saves unchanged, keeping the stored rows', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('#access tbody tr', { timeout: U.shortTimeout });
    const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/project/json/${SHORTNAME}`), { timeout: U.shortTimeout });
    const [save] = await page.$x('//button[contains(normalize-space(.), "Save Changes")]');
    await save.click();
    const res = await answer;
    const body = await res.json();
    assert.equal(res.status(), 200, JSON.stringify(body));
    assert.isTrue(body.success);
    assert.deepEqual(body.dropped, { files: 0, collaborators: 0, annotations: 0 });

    const stored = await U.queryProject(SHORTNAME);
    // the stored rows are all kept (the strings now as {source, name}, as the
    // page sends them), nothing dropped
    assert.deepEqual(stored.files.list.map((f) => f.source), ['http://m3a2-legacy.localhost/plain-string.dzi', 'http://m3a2-legacy.localhost/with space.dzi', '', '', 'http://m3a2-legacy.localhost/object.dzi']);
    assert.lengthOf(stored.annotations.list, 3);
    assert.lengthOf(stored.collaborators.list, 2);
  }).timeout(U.mediumTimeout);
});
