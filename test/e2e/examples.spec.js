'use strict';

/*
  M8b: smoke tests for the example pages in app/public/examples/ (see its
  README.md): each loads its vendored libraries, runs without errors in its
  own frame and shows its control panel; the old URLs at the site root
  redirect there (302 since N3). The layers are microdraw viewers in iframes:
  their images and errors are not checked here.

  Offline (N3): requests to other hosts are aborted, and the viewers' requests
  for BigBrain data through the server (`/getJson?source=https://bigbrain-ftp…`,
  `/getTile?source=…`) are answered here, so that the server never fetches
  bigbrain-ftp.loris.ca during the tests. /getJson gets a canned description
  of the local test image.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

// Resolve once `condition()` is true (polled every 50 ms), or reject after shortTimeout
const waitFor = (condition) => new Promise((resolve, reject) => {
  const start = Date.now();
  const poll = () => {
    if (condition()) {
      resolve();
    } else if (Date.now() - start > U.shortTimeout) {
      reject(new Error('timed out'));
    } else {
      setTimeout(poll, 50);
    }
  };
  poll();
});
const isLocal = (u) => ['localhost', '127.0.0.1'].includes(u.hostname);
// what /getJson answers for a BigBrain source, in place of the server's fetch
const CANNED_JSON = { tileSources: ['/test_data/cat.dzi'], pixelsPerMeter: 10000 };

const EXAMPLES = [
  {
    page: 'composer.html',
    query: '?config=/examples/composer-example.json',
    vue: true,
    // the layers named in composer-example.json, rendered by Vue
    ready: () => document.querySelectorAll('#ctrl tr td:first-child span').length === 2,
    text: () => [...document.querySelectorAll('#ctrl tr td:first-child span')].map((s) => s.textContent),
    expected: ['cat', 'cat (overlay)'],
    // requests for data on other hosts through the server: composer-example.json is local
    external: 0
  },
  {
    page: 'composer-0.html',
    query: '',
    vue: true,
    ready: () => document.querySelectorAll('#ctrl tr input:not([type])').length === 4,
    text: () => [...document.querySelectorAll('#ctrl tr td:first-child input')].map((i) => i.value),
    expected: ['Layer 1', 'Layer 2'],
    external: 2
  },
  {
    page: 'overlays.html',
    query: '',
    vue: false,
    ready: () => document.querySelectorAll('iframe').length === 2,
    text: () => [...document.querySelectorAll('#ctrl input[type=range]')].map((i) => i.value),
    expected: ['0', '50'],
    external: 2
  }
];

/**
 * How a request is answered offline: 'abort' (another host), 'canned' (/getJson
 * for another host), 'none' (/getTile for another host) or 'continue'.
 * @param {URL} u The request's URL
 * @returns {string} The answer
 */
const offlineRoute = (u) => {
  if (!isLocal(u) && u.protocol.startsWith('http')) { return 'abort'; }
  const source = u.searchParams.get('source');
  if (!['/getJson', '/getTile'].includes(u.pathname) || !source || isLocal(new URL(source, u))) { return 'continue'; }

  return u.pathname === '/getJson' ? 'canned' : 'none';
};

// eslint-disable-next-line max-statements
describe('Example pages (M8b)', function () {
  let context, page;
  const problems = [];
  // the /getJson requests for other hosts answered with CANNED_JSON
  const canned = [];

  // Abort requests to other hosts; answer the server routes that would fetch them
  const answerOffline = (req) => {
    if (req.isInterceptResolutionHandled()) { return; }
    const u = new URL(req.url());
    const route = offlineRoute(u);
    if (route === 'abort') {
      req.abort();
    } else if (route === 'canned') {
      canned.push(u.searchParams.get('source'));
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(CANNED_JSON) });
    } else if (route === 'none') {
      req.respond({ status: 404, body: '' });
    } else {
      req.continue();
    }
  };

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
    await page.setRequestInterception(true);
    page.on('request', answerOffline);
    page.on('response', (res) => {
      if (res.frame() === page.mainFrame() && res.status() >= 400) { problems.push(`${res.status()} ${res.url()}`); }
    });
    page.on('requestfailed', (req) => {
      if (req.frame() === page.mainFrame() && !req.isNavigationRequest()) { problems.push(`failed ${req.url()}`); }
    });
  });

  beforeEach(function () {
    problems.length = 0;
    canned.length = 0;
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
      assert.equal(chain[0].response().status(), 302);
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
      // every viewer of the page asked for its BigBrain data, and got the canned answer
      await waitFor(() => canned.length >= example.external);
      assert.lengthOf(canned, example.external);
      assert.isTrue(canned.every((source) => source.startsWith('https://bigbrain-ftp.loris.ca/')), canned.join(', '));
      // stop the viewers in the iframes
      await page.goto('about:blank');
    }).timeout(U.mediumTimeout);
  });
});
