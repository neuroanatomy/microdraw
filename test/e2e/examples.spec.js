'use strict';

/*
  M8b: smoke tests for the example pages in app/public/examples/ (see its
  README.md): each loads its vendored libraries, runs without errors in its
  own frame and shows its control panel; the old URLs at the site root
  redirect there. The layers are microdraw viewers in iframes: their images
  (BigBrain data from the network for two of the pages) and errors are not
  checked here.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const EXAMPLES = [
  {
    page: 'composer.html',
    query: '?config=/examples/composer-example.json',
    vue: true,
    // the layers named in composer-example.json, rendered by Vue
    ready: () => document.querySelectorAll('#ctrl tr td:first-child span').length === 2,
    text: () => [...document.querySelectorAll('#ctrl tr td:first-child span')].map((s) => s.textContent),
    expected: ['cat', 'cat (overlay)']
  },
  {
    page: 'composer-0.html',
    query: '',
    vue: true,
    ready: () => document.querySelectorAll('#ctrl tr input:not([type])').length === 4,
    text: () => [...document.querySelectorAll('#ctrl tr td:first-child input')].map((i) => i.value),
    expected: ['Layer 1', 'Layer 2']
  },
  {
    page: 'overlays.html',
    query: '',
    vue: false,
    ready: () => document.querySelectorAll('iframe').length === 2,
    text: () => [...document.querySelectorAll('#ctrl input[type=range]')].map((i) => i.value),
    expected: ['0', '50']
  }
];

describe('Example pages (M8b)', function () {
  let context, page;
  const problems = [];

  before(async function () {
    context = await H.newContext();
    page = await context.newPage();
    await page.setViewport({ width: U.width, height: U.height });
    // Errors of the example page itself, not of the viewers in its iframes
    await page.evaluateOnNewDocument(() => {
      if (window.top !== window) { return; }
      window.__exampleErrors = [];
      window.addEventListener('error', (e) => window.__exampleErrors.push(`error: ${e.message || (e.target && (e.target.src || e.target.href))}`), true);
      window.addEventListener('unhandledrejection', (e) => window.__exampleErrors.push(`unhandled rejection: ${e.reason}`));
      const { error, warn } = console;
      console.error = (...args) => { window.__exampleErrors.push(`console.error: ${args.join(' ')}`); error.apply(console, args); };
      console.warn = (...args) => { window.__exampleErrors.push(`console.warn: ${args.join(' ')}`); warn.apply(console, args); };
    });
    page.on('response', (res) => {
      if (res.frame() === page.mainFrame() && res.status() >= 400) { problems.push(`${res.status()} ${res.url()}`); }
    });
    page.on('requestfailed', (req) => {
      if (req.frame() === page.mainFrame() && !req.isNavigationRequest()) { problems.push(`failed ${req.url()}`); }
    });
  });

  beforeEach(function () {
    problems.length = 0;
  });

  after(async function () {
    await H.closeContext(context);
  });

  EXAMPLES.forEach((example) => {
    // eslint-disable-next-line max-statements
    it(`${example.page} loads without errors and shows its panel; its old URL redirects`, async function () {
      // the old URL, at the site root
      const res = await page.goto(U.url(`/${example.page}${example.query}`), { waitUntil: 'load' });
      const chain = res.request().redirectChain();
      assert.lengthOf(chain, 1, 'not redirected');
      assert.equal(chain[0].response().status(), 301);
      assert.equal(page.url(), U.url(`/examples/${example.page}${example.query}`));

      await page.waitForFunction(example.ready, { polling: 50, timeout: U.shortTimeout });
      await H.settleFrames(page);
      assert.deepEqual(await page.evaluate(example.text), example.expected);
      assert.isTrue(await page.$eval('#ctrl', (el) => el.getBoundingClientRect().height > 0), 'no control panel');
      if (example.vue) {
        assert.equal(await page.evaluate(() => window.Vue && window.Vue.version), '2.7.16');
      }
      assert.deepEqual(await page.evaluate(() => window.__exampleErrors), []);
      assert.deepEqual(problems, []);
      // stop the viewers in the iframes
      await page.goto('about:blank');
    }).timeout(U.mediumTimeout);
  });
});
