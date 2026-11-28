/* global Microdraw */
'use strict';

/*
  The viewer asks its host for what depends on where it runs (Microdraw.init's
  second argument; the web's is js/web-host.js). Here the web host's file is
  replaced by a test host: what it answers is what the viewer shows. So far
  the host gives the label set.
*/
const { assert } = require('chai');
const U = require('../mocha.test.util');
const H = require('./helpers');

const PROJECT = 'e2eviewerhost';
const SET = { name: 'From the test host', labels: [{ name: 'Host label', value: 1, color: [1, 2, 3] }] };

// a host that answers late, and says how it was made and asked
const testHost = (answer) => `
  window.hostCalls = [];
  window.MicrodrawWebHost = {
    create: (context) => {
      window.hostCalls.push(['create', context]);

      return {
        labelSet: async () => {
          window.hostCalls.push(['labelSet']);
          await new Promise((resolve) => setTimeout(resolve, 300));
          ${answer}
        }
      };
    }
  };`;

describe('The viewer and its host', () => {
  const project = U.createPublicAnnotationProject(PROJECT);
  let context;

  before(async () => {
    await U.removeProject(PROJECT);
    await U.insertProject(project);
    context = await H.newContext();
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(PROJECT);
    }
  });

  // the viewer with `script` served as js/web-host.js; the paths asked for
  const open = async (script) => {
    const page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    const asked = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      asked.push(pathname);
      if (pathname === '/js/web-host.js') {
        request.respond({ status: 200, contentType: 'application/javascript', body: script });
      } else {
        request.continue();
      }
    });
    await H.openData(page, U.url(`/data?source=/test_data/cat.json&project=${PROJECT}&slice=0`));

    return { page, asked };
  };

  const labelRequests = (asked) => asked.filter((p) => p === '/api/getLabelsets' || p.startsWith('/labels/') || p.startsWith('/project/json/'));

  it('shows the label set its host gives, and looks for none itself', async () => {
    const { page, asked } = await open(testHost(`return ${JSON.stringify(SET)};`));
    await page.waitForFunction((name) => Microdraw.ontology && Microdraw.ontology.name === name, { timeout: U.shortTimeout }, SET.name);
    assert.deepEqual(await page.evaluate(() => window.hostCalls), [['create', { project: PROJECT }], ['labelSet']]);
    assert.deepEqual(labelRequests(asked), []);
    const color = await page.evaluate(() => Microdraw.dom.querySelector('#color').style.backgroundColor);
    assert.equal(color, 'rgb(1, 2, 3)');
    await page.close();
  }).timeout(U.longTimeout);

  it('still shows the image when its host has no label set', async () => {
    const { page } = await open(testHost('throw new Error(\'no labels here\');'));
    assert.deepEqual(await page.evaluate(() => [Microdraw.currentImage, Boolean(Microdraw.ontology)]), ['0', false]);
    await page.close();
  }).timeout(U.longTimeout);
});
