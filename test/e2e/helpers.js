/* eslint-disable max-lines */
'use strict';

/*
  Helpers for the browser (e2e) specs: open a Microdraw data page and wait on
  real conditions, and read what is rendered (Paper.js regions, the OSD
  viewport, canvas pixels). Shared constants (timeouts, viewport size, URLs)
  stay in ../mocha.test.util.js.
*/
const fs = require('fs');
const path = require('path');
const { shortTimeout, mediumTimeout, url } = require('../mocha.test.util');
const { launchBrowser } = require('./browser');

// One browser for the whole e2e run, started and closed by runner.js. Each spec
// works in its own incognito context (separate cookies and storage), which it
// closes in its after hook with closeContext. acceptInsecureCerts
// (ignoreHTTPSErrors before puppeteer 22) is what permissions.spec.js used to
// launch its own browser with.
let sharedBrowser = null;
const startBrowser = async () => {
  sharedBrowser = await launchBrowser({ acceptInsecureCerts: true });
};
const stopBrowser = async () => {
  if (sharedBrowser) {
    const browser = sharedBrowser;
    sharedBrowser = null;
    await browser.close();
  }
};
const newContext = () => {
  if (!sharedBrowser) { throw new Error('no shared browser: run the e2e specs through test/e2e/runner.js'); }

  return sharedBrowser.createBrowserContext();
};

/**
 * Close a spec's browser context, for its after hook. A context that was never
 * created (its before hook failed) is skipped. Waits at most shortTimeout: a
 * dead browser may never answer. Errors are thrown, so call it in a `try` and
 * do the DB cleanup in the `finally` (M5f): a crashed browser must not leave
 * projects, users or annotations behind for the next run.
 * @param {object} [context] The context from newContext()
 * @returns {Promise} Resolves when the context is closed
 */
const closeContext = async (context) => {
  if (!context) {
    return;
  }
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`browser context not closed after ${shortTimeout} ms`)), shortTimeout);
  });
  try {
    await Promise.race([context.close(), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

// Pages opened through openData, for the DEBUG_SCREENSHOTS failure hook in runner.js.
const openPages = new Set();
const trackPage = (page) => {
  openPages.add(page);
  page.once('close', () => openPages.delete(page));
};

/**
 * Save a screenshot of every open tracked page (only when DEBUG_SCREENSHOTS=1).
 * @param {string} name Base file name, e.g. the failed test's title
 * @returns {Promise} Resolves when the files are written
 */
const saveDebugScreenshots = async (name) => {
  const dir = path.join(__dirname, 'debug-screenshots');
  const base = name.replace(/[^\w.-]+/g, '_').slice(0, 100);
  await fs.promises.mkdir(dir, { recursive: true });
  // A page whose renderer is stuck never answers: give up on it after
  // shortTimeout, so that this afterEach hook cannot time out (a failing root
  // hook stops the whole run; CI 2026-10-13 stopped at 96 tests).
  await Promise.all([...openPages].map((page, i) => {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, shortTimeout); });

    return Promise.race([
      page.screenshot({ path: path.join(dir, `${base}.${i}.png`) }).catch(() => null),
      timeout
    ]).finally(() => clearTimeout(timer));
  }));
};

// Pages opened through openData count
// - their pending GET /api requests (the annotation loads), so that
//   waitForMicrodraw does not accept a slice whose annotations are still on their way;
// - the pending tool resets: one-shot tools (next, save, delete, ...) call
//   Microdraw.backToPreviousTool, which restores the previous tool 500 ms later,
//   overriding any tool selected in between. The wrapper only counts; it calls
//   the original unchanged.
const instrumentedPages = new WeakSet();
const instrumentPage = async (page) => {
  if (instrumentedPages.has(page)) { return; }
  instrumentedPages.add(page);
  trackPage(page);
  await page.evaluateOnNewDocument(() => {
    const proto = XMLHttpRequest.prototype;
    const { open, send } = proto;
    window.__mdTest = { pendingApiGets: 0, pendingToolResets: 0 };
    const countToolResets = (M) => ['backToPreviousTool', 'backToSelect'].forEach((name) => {
      const orig = M[name];
      M[name] = function (...args) {
        const result = orig.apply(this, args);
        window.__mdTest.pendingToolResets += 1;
        // scheduled after the original's 500 ms timer, so it runs after it
        setTimeout(() => { window.__mdTest.pendingToolResets -= 1; }, 500);

        return result;
      };
    });
    let microdraw;
    Object.defineProperty(window, 'Microdraw', {
      configurable: true,
      enumerable: true,
      get: () => microdraw,
      set: (value) => {
        if (value && !value.__mdCounted) { value.__mdCounted = true; countToolResets(value); }
        microdraw = value;
      }
    });
    proto.open = function (method, reqUrl, ...rest) {
      this.__mdApiGet = String(method).toUpperCase() === 'GET' && (/\/api(\?|$)/).test(String(reqUrl));

      return open.call(this, method, reqUrl, ...rest);
    };
    proto.send = function (...args) {
      if (this.__mdApiGet) {
        window.__mdTest.pendingApiGets += 1;
        this.addEventListener('loadend', () => { window.__mdTest.pendingApiGets -= 1; });
      }

      return send.apply(this, args);
    };
    // The same count for GET /api made with fetch (M4a: the annotation load no
    // longer goes through jQuery's XMLHttpRequest). A request ends when its
    // body has arrived (as XHR's loadend), or when it fails.
    const originalFetch = window.fetch;
    window.fetch = function (input, init, ...rest) {
      const reqUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const promise = originalFetch.call(window, input, init, ...rest);
      if (method === 'GET' && (/\/api(\?|$)/).test(reqUrl)) {
        window.__mdTest.pendingApiGets += 1;
        const done = () => { window.__mdTest.pendingApiGets -= 1; };
        promise.then((res) => res.clone().arrayBuffer())
          .then(done, done);
      }

      return promise;
    };
  });
};

/**
 * Wait until Microdraw shows slice `slice` (an index into Microdraw.imageOrder):
 * a newly opened OSD image, fully loaded, and its annotations loaded and drawn.
 * @param {Object} page A puppeteer page opened with openData
 * @param {number} slice Index of the expected slice
 * @param {number} timeout Timeout in ms
 * @returns {Promise} Resolves when the slice is ready
 */
const waitForMicrodraw = (page, slice, timeout = mediumTimeout) => page.waitForFunction((i) => {
  const M = window.Microdraw;
  if (!window.__mdTest) { throw new Error('page not instrumented: open it with U.openData'); }
  const name = M && M.viewer && M.imageOrder[i];
  const item = name && M.currentImage === name && M.viewer.world.getItemCount() === 1 && M.viewer.world.getItemAt(0);
  const ready = Boolean(item) && !item.__mdSeen && item.getFullyLoaded() &&
    window.__mdTest.pendingApiGets === 0 && window.__mdTest.pendingToolResets === 0 &&
    typeof M.ImageInfo[name].Hash !== 'undefined';
  if (ready) { item.__mdSeen = true; }

  return ready;
}, { polling: 50, timeout }, slice);

/**
 * Open a Microdraw data page and wait until its slice (URL `slice`, default 0) is ready.
 * @param {Object} page A puppeteer page
 * @param {string} pageUrl URL of the data page
 * @returns {Promise} Resolves when the slice is ready
 */
const openData = async (page, pageUrl) => {
  await instrumentPage(page);
  await page.goto(pageUrl, { waitUntil: 'load' });
  const slice = Number(new URL(pageUrl).searchParams.get('slice') || 0);
  await waitForMicrodraw(page, slice);
};

/**
 * Run `action` (e.g. clicking Save), wait for the POST /api it triggers, then
 * wait for the save dialog to close: it stays about 3 s over the top of the
 * canvas (around x 400-560, y 70-130 at 800x600) and takes clicks meant for it.
 * @param {Object} page A puppeteer page
 * @param {Function} action Async function that triggers the save
 * @param {number} timeout Timeout in ms
 * @returns {Promise} Resolves with the response; rejects if it is not ok
 */
const waitForSave = async (page, action, timeout = mediumTimeout) => {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api', { timeout }),
    action()
  ]);
  if (!res.ok()) { throw new Error(`save failed: POST /api returned ${res.status()}`); }
  await page.waitForFunction(() => {
    const dialog = window.Microdraw.dom.querySelector('#saveDialog');

    return getComputedStyle(dialog).display === 'none' && window.__mdTest.pendingToolResets === 0;
  }, { polling: 50, timeout });

  return res;
};

// Wait until no one-shot tool is about to restore the previous tool.
const waitForTools = (page, timeout = shortTimeout) => page.waitForFunction(
  () => window.__mdTest.pendingToolResets === 0,
  { polling: 50, timeout }
);

// Wait until the OSD viewport has reached its target zoom and centre and its tiles are loaded.
const waitForViewport = (page, timeout = mediumTimeout) => page.waitForFunction(() => {
  const M = window.Microdraw;
  const v = M.viewer.viewport;
  const settled = Math.abs(v.getZoom(true) - v.getZoom(false)) < 1e-9 &&
    v.getCenter(true).distanceTo(v.getCenter(false)) < 1e-9;

  return !M.isAnimating && settled && M.viewer.world.getItemAt(0).getFullyLoaded() &&
    window.__mdTest.pendingToolResets === 0;
}, { polling: 50, timeout });

// Let the browser paint two frames (OSD and Paper.js draw on requestAnimationFrame),
// so that what follows (a pixel read, say) sees the state just waited for. Capped at 500 ms,
// because a page in the background may get no animation frames.
const settleFrames = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
  setTimeout(resolve, 500);
}));

/**
 * The regions of the current slice, as Paper.js holds them.
 * bounds are in Paper.js project coordinates; viewBounds in page pixels.
 * @param {Object} page A puppeteer page
 * @returns {Promise<Array>} One entry per region, in z-order (index)
 */
const regionState = (page) => page.evaluate(() => {
  const M = window.Microdraw;
  const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const offset = window.paper.view.element.getBoundingClientRect();

  return M.ImageInfo[M.currentImage].Regions.map((reg) => {
    const p = reg.path;
    const tl = window.paper.view.projectToView(p.bounds.topLeft);
    const br = window.paper.view.projectToView(p.bounds.bottomRight);

    return {
      name: reg.name,
      segments: p.segments.length,
      curvedSegments: p.segments.filter((s) => !s.handleIn.isZero() || !s.handleOut.isZero()).length,
      closed: p.closed,
      area: Math.abs(p.area),
      bounds: rect(p.bounds),
      viewBounds: { x: tl.x + offset.left, y: tl.y + offset.top, width: br.x - tl.x, height: br.y - tl.y },
      fill: p.fillColor ? p.fillColor.toCSS(true) : null,
      fillAlpha: p.fillColor ? p.fillColor.alpha : null,
      index: p.index,
      selected: p.selected,
      isCurrent: M.region === reg
    };
  });
});

/**
 * The OSD viewport and the current slice.
 * @param {Object} page A puppeteer page
 * @returns {Promise<Object>} zoom, centre, slice index, image size, paper zoom
 */
const viewportState = (page) => page.evaluate(() => {
  const M = window.Microdraw;
  const v = M.viewer.viewport;
  const item = M.viewer.world.getItemAt(0);

  return {
    zoom: v.getZoom(true),
    centre: { x: v.getCenter(true).x, y: v.getCenter(true).y },
    slice: M.imageOrder.indexOf(M.currentImage),
    sliceCount: M.imageOrder.length,
    imageWidth: M.viewer.source.width,
    imageHeight: M.viewer.source.height,
    fullyLoaded: Boolean(item) && item.getFullyLoaded(),
    paperZoom: window.paper.view.zoom
  };
});

/**
 * The pixel expected where the given regions overlap, drawn bottom to top with
 * their own fill colour and alpha (source-over compositing).
 * @param {Array} regions Entries of regionState, bottom first
 * @returns {Array} [r, g, b, a], each 0-255
 */
const expectedFillPixel = (regions) => {
  let [r, g, b, a] = [0, 0, 0, 0];
  regions.forEach((reg) => {
    const hex = reg.fill.replace('#', '');
    const [cr, cg, cb] = [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
    const ca = reg.fillAlpha;
    const na = ca + a*(1 - ca);
    if (na > 0) {
      [r, g, b] = [[cr, r], [cg, g], [cb, b]].map(([c, o]) => ((c*ca) + (o*a*(1 - ca)))/na);
    }
    a = na;
  });

  return [r, g, b, a*255].map(Math.round);
};

/**
 * Read one pixel of a canvas at page coordinates (x, y), with getImageData.
 * @param {Object} page A puppeteer page
 * @param {string} which 'paper' (the annotation overlay) or 'osd' (the image)
 * @param {number} x Page x coordinate (as given to page.mouse)
 * @param {number} y Page y coordinate
 * @returns {Promise<Array>} [r, g, b, a], each 0-255
 */
const samplePixel = (page, which, x, y) => page.evaluate((w, px, py) => {
  const canvas = w === 'paper' ? window.paper.view.element : window.Microdraw.viewer.drawer.canvas;
  const r = canvas.getBoundingClientRect();
  const cx = Math.round((px - r.left) * canvas.width / r.width);
  const cy = Math.round((py - r.top) * canvas.height / r.height);

  return Array.from(canvas.getContext('2d').getImageData(cx, cy, 1, 1).data);
}, which, x, y);

// Diagnostics for a touch drag that does not arrive: the events the page got,
// whether it is visible, its zoom, and what is under the touch point
const recordTouches = (p) => p.evaluate(() => {
  window.__mdTouches = [];
  ['pointerdown', 'touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const point = e.changedTouches ? e.changedTouches[0] : e;
      window.__mdTouches.push(`${type}@${Math.round(point.clientX)},${Math.round(point.clientY)}`);
    }, true);
  });
});
const touchReport = (p, x, y) => p.evaluate((px, py) => {
  const root = window.Microdraw ? window.Microdraw.dom : document;
  const hit = root.elementFromPoint(px, py);

  return JSON.stringify({
    events: window.__mdTouches,
    visibility: document.visibilityState,
    scale: window.visualViewport.scale,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    hit: hit && (hit.id || hit.className)
  });
}, x, y);

// The user the e2e specs save annotations as: since H3 the server refuses
// saves without a logged-in user.
const annotator = { username: 'e2e-annotator', password: 'e2e-annotator-password' };

/**
 * Log a page's browser context in as `credentials` (local sign-in, created if
 * needed). The session cookie then holds for every page of the context.
 * @param {Object} page A puppeteer page
 * @param {Object} credentials {username, password}
 * @returns {Promise} Resolves when GET /token answers 200 (logged in)
 */
const logIn = async (page, credentials = annotator) => {
  await page.goto(url('/'), { waitUntil: 'load' });
  const loggedIn = await page.evaluate(async (c) => {
    const post = (route) => fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
      redirect: 'manual',
      credentials: 'same-origin'
    });
    // 200 once the user is stored, 409 if it exists already (NWL 0.2.0)
    const signUp = await post('/localSignup');
    if (signUp.status !== 200 && signUp.status !== 409) { return `/localSignup: ${signUp.status}`; }
    await post('/localLogin');

    return (await fetch('/token', { credentials: 'same-origin' })).ok || '/token refused after /localLogin';
  }, credentials);
  if (loggedIn !== true) { throw new Error(`could not log in as ${credentials.username}: ${loggedIn}`); }
};

module.exports = {
  annotator,
  closeContext,
  logIn,
  expectedFillPixel,
  instrumentPage,
  newContext,
  recordTouches,
  touchReport,
  openData,
  regionState,
  samplePixel,
  saveDebugScreenshots,
  settleFrames,
  startBrowser,
  stopBrowser,
  viewportState,
  waitForMicrodraw,
  waitForSave,
  waitForTools,
  waitForViewport
};
