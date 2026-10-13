'use strict';

/*
  M4a: what microdraw.js did with jQuery, recorded on the jQuery version
  (2026-10-13) and kept unchanged on the jQuery-free one:
  - the annotation load, GET /api, with jQuery.param's query string, and its
    error handling (rejects, clears the loading flag, logs the jQuery status);
  - the source JSON: direct load of a same-origin .json or .jsonp, and the
    /getJson fallback;
  - the tool registry (me.tools) after $.extend, now Object.assign;
  - the overlay resize on window resize.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const project = U.createPublicAnnotationProject('e2em4arequests');

// Every tool registered once the viewer is ready (probe, 2026-10-13, jQuery version)
const TOOLS = [
  'addPoint', 'addRegion', 'back', 'backward', 'closeMenu', 'color', 'copy', 'delete',
  'deletePoint', 'draw', 'drawLine', 'drawPolygon', 'findContours', 'flipRegion',
  'foreward', 'front', 'fullscreen', 'home', 'layers', 'move', 'navigate', 'next',
  'openMenu', 'paste', 'previous', 'redo', 'rotate', 'save', 'screenshot', 'select',
  'simplify', 'splitRegion', 'subtractRegion', 'textAnnotation', 'toBezier',
  'toPolygon', 'undo', 'zoomIn', 'zoomOut'
];

let context;
let page;

// Collect the requests whose path is `pathname` while `action` runs
const requestsDuring = async (pathname, action) => {
  const seen = [];
  const onRequest = (req) => {
    if (new URL(req.url()).pathname === pathname) { seen.push(req.url()); }
  };
  page.on('request', onRequest);
  try {
    await action();
  } finally {
    page.off('request', onRequest);
  }

  return seen;
};

// Run Microdraw.microdrawDBLoad() in the page and report how it settled
const dbLoad = () => page.evaluate(async () => {
  window.Microdraw.annotationLoadingFlag = true;
  try {
    const data = await window.Microdraw.microdrawDBLoad();

    return { resolved: true, data, flag: window.Microdraw.annotationLoadingFlag };
  } catch (err) {
    return { resolved: false, reason: String(err), flag: window.Microdraw.annotationLoadingFlag };
  }
});

// Answer the matching requests with `response` while `action` runs
const intercepting = async (match, response, action) => {
  const onRequest = (req) => {
    if (req.isInterceptResolutionHandled()) { return; }
    if (match(new URL(req.url()))) {
      req.respond(response);
    } else {
      req.continue();
    }
  };
  await page.setRequestInterception(true);
  page.on('request', onRequest);
  try {
    return await action();
  } finally {
    page.off('request', onRequest);
    await page.setRequestInterception(false);
  }
};

describe('Viewer requests and tool registry (M4a)', () => {
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

  it('loads the annotations with GET /api and the query string of jQuery.param', async () => {
    const seen = await requestsDuring('/api', () => H.openData(page, U.url(`/data?source=/test_data/cat.json&project=${project.shortname}&slice=0`)));
    assert.lengthOf(seen, 1);
    assert.equal(new URL(seen[0]).search, `?action=load_last&source=%2Ftest_data%2Fcat.json&slice=0&project=${project.shortname}`);
  }).timeout(U.mediumTimeout);

  // jQuery.ajax deep-copies `data` first, which drops undefined values; jQuery.param then writes null as ''
  it('encodes the query as jQuery.param: spaces as +, reserved characters escaped, undefined left out, null empty', async () => {
    const source = await page.evaluate(() => window.Microdraw.source);
    try {
      let seen = await requestsDuring('/api', () => page.evaluate(() => {
        window.Microdraw.source = 'a b+c/é?&=!*~()';

        return window.Microdraw.microdrawDBLoad();
      }));
      assert.lengthOf(seen, 1);
      assert.equal(new URL(seen[0]).search, `?action=load_last&source=a+b%2Bc%2F%C3%A9%3F%26%3D!*~()&slice=0&project=${project.shortname}`);

      seen = await requestsDuring('/api', () => page.evaluate(() => {
        window.Microdraw.source = undefined; // eslint-disable-line no-undefined

        return window.Microdraw.microdrawDBLoad();
      }));
      assert.equal(new URL(seen[0]).search, `?action=load_last&slice=0&project=${project.shortname}`);

      seen = await requestsDuring('/api', () => page.evaluate(() => {
        window.Microdraw.source = null;

        return window.Microdraw.microdrawDBLoad();
      }));
      assert.equal(new URL(seen[0]).search, `?action=load_last&source=&slice=0&project=${project.shortname}`);
    } finally {
      await page.evaluate((s) => { window.Microdraw.source = s; }, source);
    }
  }).timeout(U.mediumTimeout);

  it('resolves with the parsed answer and clears the loading flag', async () => {
    const res = await intercepting(
      (u) => u.pathname === '/api',
      { status: 200, contentType: 'application/json', body: '[{"m4":1}]' },
      dbLoad
    );
    assert.deepEqual(res, { resolved: true, data: [{ m4: 1 }], flag: false });
  }).timeout(U.mediumTimeout);

  it('rejects with the status text when GET /api fails, and clears the loading flag', async () => {
    const logs = [];
    const onConsole = (m) => logs.push(m.text());
    page.on('console', onConsole);
    const res = await intercepting(
      (u) => u.pathname === '/api',
      { status: 500, contentType: 'text/plain', body: 'oops' },
      dbLoad
    );
    page.off('console', onConsole);
    assert.deepEqual(res, { resolved: false, reason: 'Internal Server Error', flag: false });
    assert.include(logs, '< microdrawDBLoad resolve ERROR: error Internal Server Error');
  }).timeout(U.mediumTimeout);

  it('rejects with a SyntaxError when GET /api answers something that is not JSON', async () => {
    const logs = [];
    const onConsole = (m) => logs.push(m.text());
    page.on('console', onConsole);
    const res = await intercepting(
      (u) => u.pathname === '/api',
      { status: 200, contentType: 'application/json', body: 'not json' },
      dbLoad
    );
    page.off('console', onConsole);
    assert.isFalse(res.resolved);
    assert.isFalse(res.flag);
    assert.match(res.reason, /^SyntaxError/);
    assert.isTrue(logs.some((l) => l.startsWith('< microdrawDBLoad resolve ERROR: parsererror SyntaxError')), logs.join('\n'));
  }).timeout(U.mediumTimeout);

  describe('loadSourceJson', () => {
    let params;
    let expected;
    before(async () => {
      params = await page.evaluate(() => ({ ...window.Microdraw.params }));
      expected = await page.evaluate(() => fetch('/test_data/cat.json').then((r) => r.json()));
    });
    after(async () => {
      await page.evaluate((p) => { window.Microdraw.params = p; }, params);
    });

    const loadSource = (source) => page.evaluate((s) => {
      window.Microdraw.params.source = s.startsWith('/') ? window.location.origin + s : s;

      return window.Microdraw.loadSourceJson();
    }, source);

    it('reads a same-origin .json directly', async () => {
      let json;
      const getJson = await requestsDuring('/getJson', async () => {
        const direct = await requestsDuring('/test_data/cat.json', async () => { json = await loadSource('/test_data/cat.json'); });
        assert.lengthOf(direct, 1);
        assert.equal(new URL(direct[0]).search, '');
      });
      assert.deepEqual(json, expected);
      assert.lengthOf(getJson, 0);
    }).timeout(U.mediumTimeout);

    it('falls back to /getJson for a relative source', async () => {
      const getJson = await requestsDuring('/getJson', () => page.evaluate(() => {
        window.Microdraw.params.source = '/test_data/cat.json';

        return window.Microdraw.loadSourceJson();
      }));
      assert.deepEqual(getJson.map((u) => new URL(u).search), ['?source=/test_data/cat.json']);
    }).timeout(U.mediumTimeout);

    it('falls back to /getJson when the direct .json load fails', async () => {
      const getJson = await requestsDuring('/getJson', () => loadSource('/test_data/m4-missing.json').catch(() => null));
      assert.lengthOf(getJson, 1);
    }).timeout(U.mediumTimeout);

    it('reads a same-origin .jsonp through the callback f', async () => {
      const seen = [];
      const json = await intercepting(
        (u) => {
          if (u.pathname === '/test_data/m4-fixture.jsonp') { seen.push(u); }

          return u.pathname === '/test_data/m4-fixture.jsonp';
        },
        { status: 200, contentType: 'application/javascript', body: 'f({"m4":"jsonp"})' },
        () => loadSource('/test_data/m4-fixture.jsonp')
      );
      assert.deepEqual(json, { m4: 'jsonp' });
      assert.lengthOf(seen, 1);
      assert.equal(seen[0].searchParams.get('callback'), 'f');
      assert.match(seen[0].searchParams.get('_'), /^\d+$/, 'cache buster');
      assert.equal(await page.evaluate(() => typeof window.f), 'undefined', 'the callback is removed');
    }).timeout(U.mediumTimeout);
  });

  it('registers every tool in Microdraw.tools', async () => {
    await page.waitForFunction((n) => Object.keys(window.Microdraw.tools).length >= n, { timeout: U.shortTimeout }, TOOLS.length);
    const tools = await page.evaluate(() => Object.keys(window.Microdraw.tools).sort()
      .map((k) => [k, typeof window.Microdraw.tools[k], typeof window.Microdraw.tools[k].click]));
    assert.deepEqual(tools.map(([k]) => k), [...TOOLS].sort());
    tools.forEach(([k, type]) => assert.equal(type, 'object', k));
  }).timeout(U.shortTimeout);

  it('resizes the annotation overlay when the window is resized', async () => {
    await page.evaluate(() => {
      const M = window.Microdraw;
      const orig = M.resizeAnnotationOverlay;
      window.__m4Resized = 0;
      M.resizeAnnotationOverlay = function (...args) {
        window.__m4Resized += 1;

        return orig.apply(this, args);
      };
    });
    await page.setViewport({ width: U.width + 100, height: U.height + 50 });
    await page.waitForFunction(() => window.__m4Resized > 0, { timeout: U.shortTimeout });
    const width = await page.evaluate(() => window.paper.view.viewSize.width);
    await page.setViewport({ width: U.width, height: U.height });
    assert.equal(width, U.width + 100);
  }).timeout(U.mediumTimeout);
});
