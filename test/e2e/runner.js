const U = require('../mocha.test.util');
const H = require('./helpers');

// root-level before & after hooks

before(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
  this.timeout(U.longTimeout);
  await U.initResources();
  await H.startBrowser();
});

// DEBUG_SCREENSHOTS=1 saves a screenshot of each open page when a test fails,
// to test/e2e/debug-screenshots/ (gitignored).
afterEach(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the test context as this
  const test = this.currentTest;
  if (process.env.DEBUG_SCREENSHOTS && test.state === 'failed') {
    await H.saveDebugScreenshots(test.fullTitle());
  }
});

after(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
  this.timeout(U.longTimeout);
  await H.stopBrowser();
  await U.closeResources();
});
