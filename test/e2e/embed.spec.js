/* global MicrodrawEmbed paper */
/* eslint max-statements: ["error", 25] */
'use strict';

/*
  The embeddable, read-only viewer (T002 3.7), framed by a host page as
  another site would: the dataset's slice and its regions, no drawing tool,
  slice navigation, the resize messages with the computed height, the error
  page of a private dataset, another user's save shown live (the WebSocket
  ticket), and the script loader building the iframe from its data attributes.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');
const { imageAspect, desiredEmbedHeight } = require('../../app/public/js/embed-sizing');

const SOURCE = '/test_data/cat.json';
const PRIVATE_SOURCE = '/test_data/cat-zarr.json';
const RESIZE = 'microdraw:embed-resize';
// the test images' sizes (cat.dzi, doge.dzi)
const CAT = { width: 480, height: 360 };
const DOGE = { width: 2048, height: 1024 };

const editor = { username: 'e2e-embed-editor', password: 'e2e-embed-editor-password' };
const project = U.createProjectWithPermission('e2eembed', { files: 'view', annotations: 'view' });
project.collaborators.list[0].access = { collaborators: 'none', annotations: 'view', files: 'view' };
project.collaborators.list.push({
  username: editor.username,
  userID: editor.username,
  name: editor.username,
  access: { collaborators: 'none', annotations: 'edit', files: 'view' }
});
project.files.list = [{ source: SOURCE, name: 'cat' }];
const privateProject = U.createProjectWithPermission('e2eembedprivate', {});
privateProject.files.list = [{ source: PRIVATE_SOURCE, name: 'cat-zarr' }];

const triangle = (x) => ['Path', { applyMatrix: true, segments: [[x, 300], [x + 100, 300], [x + 50, 400]], closed: true }];
const regionDoc = (uid, x) => ({
  fileID: `${SOURCE}&slice=0`,
  user: editor.username,
  project: project.shortname,
  annotation: { name: 'Region 1', uid, path: triangle(x) }
});

const embedURL = (query) => U.url(`/data/embed?${new URLSearchParams(query).toString()}`);

let context;
let agent;

// A page of another site (127.0.0.1, where the embed is on localhost) with
// `html` as its content. An http page, as a real host: frame-ancestors *
// matches network origins, not about:blank.
const otherSitePage = async (html) => {
  const page = await context.newPage();
  await page.setViewport({ width: U.width, height: U.height });
  await page.goto(`${U.serverURL}/embed-spec-host`, { waitUntil: 'load' });
  await page.setContent(html);

  return page;
};

// A host page holding one iframe, which keeps the resize messages it gets
const hostPage = async (src) => {
  const page = await otherSitePage(`<!DOCTYPE html><body style="margin:0">
    <iframe id="f" src="${src}" style="display:block;width:500px;height:300px;border:0" allow="fullscreen"></iframe>
    <script>
      window.resizes = [];
      window.addEventListener('message', (e) => {
        if (e.source === document.getElementById('f').contentWindow && e.data && e.data.type === '${RESIZE}') {
          window.resizes.push(e.data);
        }
      });
    </script></body>`);
  const frame = await (await page.$('#f')).contentFrame();

  return { page, frame };
};

// the slice shown, its regions fetched and drawn
const waitForSlice = (frame, slice) => frame.waitForFunction((s) => window.MicrodrawEmbed &&
  document.getElementById('embed').dataset.state === 'ready' &&
  MicrodrawEmbed.current === s && MicrodrawEmbed.drawnSlice === s && MicrodrawEmbed.fetching === 0,
{ polling: 50, timeout: U.mediumTimeout }, slice);

const drawnUids = (frame) => frame.evaluate(() => MicrodrawEmbed.regions.map((r) => r.uid).sort());

describe('Embeddable viewer in a host page (T002 3.7)', function () {
  before(async function () {
    await Promise.all([project, privateProject].map((p) => U.removeProject(p.shortname)));
    await U.insertProject([project, privateProject]);
    await U.insertAnnotations([regionDoc('e2e-embed-1', 100)]);
    agent = await U.logIn(editor);
    context = await H.newContext();
  });

  after(async function () {
    try {
      await H.closeContext(context);
    } finally {
      // agent.close() would close the shared server: only the data goes
      await U.removeProjectAnnotations(project.shortname);
      await Promise.all([project, privateProject].map((p) => U.removeProject(p.shortname)));
      await U.removeLocalUser(editor.username);
    }
  });

  it('shows a public dataset\'s slice and its regions, with no drawing tool', async function () {
    const { page, frame } = await hostPage(embedURL({ source: SOURCE, project: project.shortname, slice: '0' }));
    await waitForSlice(frame, '0');
    assert.deepEqual(await drawnUids(frame), ['e2e-embed-1']);
    assert.equal(await frame.evaluate(() => paper.project.activeLayer.children.length), 1);
    const ui = await frame.evaluate(() => ({
      buttons: [...document.querySelectorAll('button')].map((b) => b.id)
        .filter((id) => id !== 'fullscreen'),
      microdraw: typeof window.Microdraw,
      tools: Boolean(document.querySelector('#draw, #save, #select, #msg, #logScript'))
    }));
    assert.deepEqual(ui, {
      buttons: ['previous', 'next', 'zoomIn', 'zoomOut', 'home', 'labels'],
      microdraw: 'undefined',
      tools: false
    });
    await page.close();
  }).timeout(U.longTimeout);

  it('navigates slices, and the host gets the computed height of each', async function () {
    const { page, frame } = await hostPage(embedURL({ source: SOURCE, project: project.shortname, slice: '0' }));
    await waitForSlice(frame, '0');
    await page.waitForFunction(() => window.resizes.some((m) => m.slice === 0), { polling: 50, timeout: U.shortTimeout });
    const toolbar = await frame.evaluate(() => document.getElementById('tools').offsetHeight);
    const first = (await page.evaluate(() => window.resizes)).find((m) => m.slice === 0);
    assert.equal(first.width, 500);
    assert.closeTo(first.aspect, imageAspect(CAT), 1e-9);
    assert.equal(first.height, desiredEmbedHeight({ width: 500, aspect: imageAspect(CAT), toolbarHeight: toolbar }));

    await frame.click('#next');
    await waitForSlice(frame, '1');
    assert.deepEqual(await drawnUids(frame), []);
    await page.waitForFunction(() => window.resizes.some((m) => m.slice === 1), { polling: 50, timeout: U.shortTimeout });
    const second = (await page.evaluate(() => window.resizes)).find((m) => m.slice === 1);
    assert.equal(second.height, desiredEmbedHeight({ width: 500, aspect: imageAspect(DOGE), toolbarHeight: toolbar }));
    assert.isTrue(await frame.$eval('#next', (b) => b.disabled), 'the last slice');

    await frame.click('#previous');
    await waitForSlice(frame, '0');
    assert.deepEqual(await drawnUids(frame), ['e2e-embed-1']);
    assert.include(await frame.$eval('#microdrawLink', (a) => a.href), '/data?source=%2Ftest_data%2Fcat.json&project=e2eembed&slice=0');
    await page.close();
  }).timeout(U.longTimeout);

  it('shows the error page for a private dataset', async function () {
    const { page, frame } = await hostPage(embedURL({ source: PRIVATE_SOURCE, project: privateProject.shortname }));
    await frame.waitForSelector('#embedErrorMessage', { timeout: U.shortTimeout });
    assert.equal(await frame.$eval('#embedErrorMessage', (p) => p.textContent), 'This content is private.');
    await page.close();
  }).timeout(U.longTimeout);

  it('shows another user\'s save without a reload (the WebSocket ticket)', async function () {
    const { page, frame } = await hostPage(embedURL({ source: SOURCE, project: project.shortname, slice: '0' }));
    await waitForSlice(frame, '0');
    await frame.waitForFunction(() => MicrodrawEmbed.joined === '0', { polling: 50, timeout: U.shortTimeout });
    const res = await agent.post('/api').send({
      action: 'save',
      source: SOURCE,
      slice: '0',
      project: project.shortname,
      Hash: 'e2eembed',
      annotation: JSON.stringify({ Regions: [{ name: 'Region 2', uid: 'e2e-embed-live', path: triangle(300) }], RegionsToRemove: [] })
    });
    assert.equal(res.status, 200, res.text);
    await frame.waitForFunction(() => MicrodrawEmbed.regions.some((r) => r.uid === 'e2e-embed-live') && MicrodrawEmbed.fetching === 0,
      { polling: 50, timeout: U.shortTimeout });
    assert.deepEqual(await drawnUids(frame), ['e2e-embed-1', 'e2e-embed-live']);
    await page.close();
  }).timeout(U.longTimeout);

  it('the script loader builds the iframe from its data attributes, and sizes it', async function () {
    const page = await otherSitePage(`<!DOCTYPE html><body>
      <script src="${U.url('/embed.js')}" data-source="${SOURCE}" data-project="${project.shortname}"
              data-slice="1" data-max-height="250" data-microdraw-link="0"></script></body>`);
    const iframe = await page.waitForSelector('iframe.microdraw-embed', { timeout: U.shortTimeout });
    const src = new URL(await iframe.evaluate((f) => f.src));
    assert.equal(src.pathname, '/data/embed');
    assert.deepEqual(Object.fromEntries(src.searchParams), {
      source: SOURCE, project: project.shortname, slice: '1', maxHeight: '250', microdrawLink: '0'
    });
    assert.equal(await iframe.evaluate((f) => f.getAttribute('allow')), 'fullscreen');
    // doge is 2:1 in a 560px box: 280px of image and the toolbar, capped at 250
    await page.waitForFunction(() => document.querySelector('iframe.microdraw-embed').style.height === '250px',
      { polling: 50, timeout: U.mediumTimeout });
    const frame = await iframe.contentFrame();
    await waitForSlice(frame, '1');
    assert.isNull(await frame.$('#microdrawLink'));
    await page.close();
  }).timeout(U.longTimeout);
});
