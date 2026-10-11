/* eslint-disable max-lines -- over 300 lines until T0.3 removes the screenshot helpers; 2026-10-11 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const pixelmatch = require('pixelmatch');
// const { createHttpTerminator } = require('http-terminator');
const microdrawApp = require('../app/app');

let appServer, db, wsServer;
let serverPort = 3000;

// permissions.spec.js cookies against 127.0.0.1, the screenshot specs localhost.
const serverOrigin = () => `http://127.0.0.1:${serverPort}`;
const url = (pathname = '') => `http://localhost:${serverPort}${pathname}`;

const initResources = async () => {
  let app, port;
  // Port 0 => OS picks a free one. Pin with E2E_PORT / E2E_WS_PORT if needed.
  process.env.PORT = process.env.E2E_PORT || '0';
  process.env.WS_PORT = process.env.E2E_WS_PORT || '0';
  // Pin the config so results ignore the developer's gitignored cfg.json.
  process.env.CFG_PATH = process.env.CFG_PATH || './cfg.json.example';
  ({ server: appServer, app, wsServer, port } = await microdrawApp.start());
  serverPort = port;
  db = app.db.mongoDB();
};

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

const closeResources = async () => {
  if (db) {
    db.close();
  }
  if (wsServer) {
    await closeServer(wsServer);
  }
  if (appServer) {
    await closeServer(appServer);
  }
};

const getServer = () => appServer;

const newPath = './test/e2e/screenshots/';
const refPath = './test/reference-screenshots/';
const width = 800;
const height = 600;
const pct1 = 0.01 * width * height;
const pct5 = 0.05 * width * height;

const delay = async function (delayTimeout) {
  await new Promise((resolve) => {
    setTimeout(resolve, delayTimeout);
  });
};

// Timeouts, as in BrainBox's test/utils.js.
const shortTimeout = 6 * 1000;
const mediumTimeout = 10 * 1000;
const longTimeout = 30 * 1000;

// Pages opened through openData (or comparePageScreenshots) count
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

// Mark the viewer's current image as already waited for: the next
// waitForMicrodraw then needs a newly opened image.
const markCurrentItem = (page) => page.evaluate(() => {
  const item = window.Microdraw && window.Microdraw.viewer && window.Microdraw.viewer.world.getItemAt(0);
  if (item) { item.__mdSeen = true; }
});

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
// so that a following screenshot shows the state just waited for. Capped at 500 ms,
// because a page in the background may get no animation frames.
const settleFrames = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
  setTimeout(resolve, 500);
}));

// eslint-disable-next-line max-statements
const waitUntilHTMLRendered = async function(page, timeout = 30000) {
  const checkDurationMsecs = 1000;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;

  for (checkCounts = 1; checkCounts <= maxChecks; checkCounts++) {
    /* eslint-disable no-await-in-loop */
    const html = await page.content();
    const currentHTMLSize = html.length;

    if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
      countStableSizeIterations+=1;
    } else {
      countStableSizeIterations = 0; //reset the counter
    }

    if (countStableSizeIterations >= minStableSizeIterations) {
      // console.log("Page rendered fully..");
      break;
    }

    lastHTMLSize = currentHTMLSize;
    await page.waitForTimeout(checkDurationMsecs);
    /* eslint-enable no-await-in-loop */
  }
};


// eslint-disable-next-line max-statements
const compareImages = async function (pathImg1, pathImg2) {
  const data1 = await fs.promises.readFile(pathImg1);
  const data2 = await fs.promises.readFile(pathImg2);
  let img1, img2;
  if (pathImg1.split(".").pop() === "png") {
    img1 = PNG.sync.read(data1);
  } else if (pathImg1.split(".").pop() === "jpg") {
    img1 = jpeg.decode(data1);
  }
  if (pathImg2.split(".").pop() === "png") {
    img2 = PNG.sync.read(data2);
  } else if (pathImg2.split(".").pop() === "jpg") {
    img2 = jpeg.decode(data2);
  }
  const pixdiff = pixelmatch(img1.data, img2.data, null, img1.width, img1.height);

  return pixdiff;
};

// eslint-disable-next-line max-statements -- screenshot helper, removed in T0.3; 2026-10-11
const comparePageScreenshots = async function (testPage, pageUrl, filename, beforeScreenshot) {
  const newFilePath = './test/e2e/screenshots/' + filename;
  const refFilePath = './test/reference-screenshots/' + filename;
  await instrumentPage(testPage);
  await testPage.goto(pageUrl, { waitUntil: 'networkidle0' });
  await waitUntilHTMLRendered(testPage);
  await markCurrentItem(testPage);
  if (beforeScreenshot) {
    await beforeScreenshot(testPage);
  }
  await testPage.screenshot({ path: newFilePath });
  const pixdiff = await compareImages(newFilePath, refFilePath);

  return pixdiff;
};

const getMockfsConfig = (dirname, filename, content) => {
  const obj = {};
  obj[path.join(dirname, filename)] = content;

  return obj;
};

const testingCredentials = {
  username: "testing-user",
  password: "baz"
};

const insertUser = function (user) {
  return db.get('users').insert(user);
};

const insertProject = function (project) {
  return db.get('projects').insert(project);
};

const queryProject = function (shortname) {
  return db.get('projects').findOne({ shortname, backup: { $exists: 0 } });
};

const removeLocalUser = function (username) {
  return db.get('users').remove({ username });
};

const removeUser = function (nickname) {
  return db.get('users').remove({ nickname });
};

const removeProject = function (shortname) {
  return db.get('projects').remove({ shortname });
};

const parseCookies = (str) => str
  .split(';')
  .map((v) => v.split('='))
  .reduce((acc, v) => {
    if (typeof v[0] === 'undefined' || typeof v[1] === 'undefined') {
      return acc;
    }
    acc.push({
      name: decodeURIComponent(v[0].trim()),
      value: decodeURIComponent(v[1].trim()),
      url: serverOrigin()
    });

    return acc;
  }, []);

const privateProjectTest = {
  "name": "Test project",
  "shortname": "testproject",
  "url": "",
  "created": "2022-02-03T14:59:49.786Z",
  "owner": "foo",
  "collaborators": {
    "list": [
      {
        "username": "anyone",
        "access": {
          "collaborators": "none",
          "annotations": "none",
          "files": "none"
        },
        "name": "Any User"
      }
    ]
  },
  "files": {
    "list": [{ source: "https://microdraw.pasteur.fr/test_data/cat.json", name: "Cat" }]
  },
  "annotations": {
    "list": [
      {
        "type": "vectorial",
        "values": "Set I",
        "display": true,
        "name": "layer"
      }
    ]
  }
};

const createProjectWithPermission = function (name, accessProp) {
  const access = Object.assign({}, {
    collaborators: "none",
    annotations: "none",
    files: "none"
  }, accessProp);

  const project = {
    "name": name,
    "shortname": name,
    "url": "http://foo.bar",
    "created": "2022-02-03T14:59:49.786Z",
    "owner": "foo",
    "collaborators": {
      "list": [
        {
          "username": "anyone",
          "access": {
            "collaborators": "none",
            "annotations": "none",
            "files": "none"
          },
          "name": "Any User"
        }
      ]
    },
    "files": {
      "list": [{ source: "https://microdraw.pasteur.fr/test_data/cat.json", name: "cat" }]
    },
    "annotations": {
      "list": [
        {
          "type": "vectorial",
          "values": "Set I",
          "display": true,
          "name": "layer"
        }
      ]
    }

  };

  project.collaborators.list.push({
    access,
    userID: testingCredentials.username,
    username: testingCredentials.username,
    name: testingCredentials.username
  });

  return project;
};

module.exports = {
  compareImages,
  comparePageScreenshots,
  delay,
  instrumentPage,
  openData,
  settleFrames,
  waitForMicrodraw,
  waitForSave,
  waitForViewport,
  waitForTools,
  shortTimeout,
  mediumTimeout,
  longTimeout,
  getMockfsConfig,
  waitUntilHTMLRendered,
  insertUser,
  removeUser,
  removeLocalUser,
  insertProject,
  removeProject,
  queryProject,
  createProjectWithPermission,
  initResources,
  closeResources,
  getServer,
  parseCookies,
  url,
  testingCredentials,
  privateProjectTest,
  newPath,
  refPath,
  width,
  height,
  pct1,
  pct5
};

// A getter, not a value: the port is only known once initResources() has run.
Object.defineProperty(module.exports, 'serverURL', { get: serverOrigin, enumerable: true });
