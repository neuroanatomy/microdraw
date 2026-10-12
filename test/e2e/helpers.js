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
// closes in its after hook. ignoreHTTPSErrors is what permissions.spec.js used
// to launch its own browser with.
let sharedBrowser = null;
const startBrowser = async () => {
  sharedBrowser = await launchBrowser({ ignoreHTTPSErrors: true });
};
const stopBrowser = async () => {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
};
const newContext = () => {
  if (!sharedBrowser) { throw new Error('no shared browser: run the e2e specs through test/e2e/runner.js'); }

  return sharedBrowser.createIncognitoBrowserContext();
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
  await Promise.all([...openPages].map((page, i) => page.screenshot({ path: path.join(dir, `${base}.${i}.png`) }).catch(() => null)));
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
    await post('/localSignup');
    // /localSignup may answer before its insert has finished: retry the login
    /* eslint-disable no-await-in-loop -- sequential retries */
    for (let i = 0; i < 20; i += 1) {
      await post('/localLogin');
      if ((await fetch('/token', { credentials: 'same-origin' })).ok) { return true; }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    /* eslint-enable no-await-in-loop */

    return false;
  }, credentials);
  if (!loggedIn) { throw new Error(`could not log in as ${credentials.username}`); }
};

module.exports = {
  annotator,
  logIn,
  expectedFillPixel,
  instrumentPage,
  newContext,
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
