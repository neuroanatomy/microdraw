'use strict';

/*
  The screenshot plugin (vendored Openseadragon-screenshot) builds a loading
  overlay that showed ajax_loader_gray_32.gif from OSD's images. OSD does not
  ship it, so every viewer load got a 404. The overlay draws a CSS spinner now,
  with no request.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const project = U.createPublicAnnotationProject('e2escreenshotoverlay');
const dataUrl = () => U.url(`/data?source=/test_data/cat.json&project=${project.shortname}&slice=0`);

let context;
let page;

// In the page: the spinner as drawn when the overlay shows
const spinnerOf = () => {
  const box = document.querySelector('.screenshot-box');
  const spinner = box.querySelector('.screenshot-spinner');
  box.style.display = 'inline';
  const drawn = {
    animation: getComputedStyle(spinner).animationName,
    width: spinner.getBoundingClientRect().width,
    images: box.querySelectorAll('img').length
  };
  box.style.display = 'none';

  return drawn;
};

// In the page: the display values the plugin gives the overlay while it makes a
// screenshot, up to the moment it hands the image over (saveAs, stubbed: no download)
const displaysDuringScreenshot = () => new Promise((resolve) => {
  const { style } = document.querySelector('.screenshot-box');
  const displays = [];
  Object.defineProperty(style, 'display', {
    configurable: true,
    get: () => style.getPropertyValue('display'),
    set: (v) => { displays.push(v); style.setProperty('display', v); }
  });
  window.saveAs = () => {
    delete style.display;
    resolve(displays);
  };
  window.Microdraw.viewer.screenshotInstance.takeScreenshot();
});

// The paths the page asks for while `action` runs, and those answered with an error status
const requestsDuring = async (action) => {
  const asked = [];
  const failed = [];
  const onRequest = (req) => asked.push(new URL(req.url()).pathname);
  const onResponse = (res) => res.status() >= 400 && failed.push(new URL(res.url()).pathname);
  page.on('request', onRequest).on('response', onResponse);
  try {
    await action();
  } finally {
    page.off('request', onRequest).off('response', onResponse);
  }

  return { asked, failed };
};

describe('Screenshot overlay: a CSS spinner, no gif', () => {
  before(async () => {
    await U.insertProject(project);
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(project.shortname);
    }
  });

  it('a viewer load asks for no spinner gif and gets no 404 from /lib/openseadragon/', async () => {
    const { asked, failed } = await requestsDuring(() => H.openData(page, dataUrl()));
    assert.isNotEmpty(asked.filter((p) => p.startsWith('/lib/openseadragon/')), 'the page loaded OSD');
    assert.deepEqual(asked.filter((p) => p.endsWith('ajax_loader_gray_32.gif')), []);
    assert.deepEqual(failed.filter((p) => p.startsWith('/lib/openseadragon/')), []);
  }).timeout(U.mediumTimeout);

  it('the overlay holds a 32 px CSS spinner and no image', async () => {
    const drawn = await page.evaluate(spinnerOf);
    assert.deepEqual(drawn, { animation: 'screenshot-spin', width: 32, images: 0 });
  }).timeout(U.shortTimeout);

  it('the overlay shows while a screenshot is made, then goes away', async () => {
    assert.deepEqual(await page.evaluate(displaysDuringScreenshot), ['inline', 'none']);
  }).timeout(U.shortTimeout);
});
