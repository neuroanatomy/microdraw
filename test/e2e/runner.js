const U = require('../mocha.test.util');
const H = require('./helpers');

// root-level before & after hooks

before(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
  this.timeout(U.longTimeout);
  await U.initResources();
  // Annotations left on the test images by an earlier run whose after hooks
  // did not run (e.g. the browser died): the next run would load them, as
  // extra regions, in every spec that opens the same image.
  await U.getDB().get('annotations')
    .remove({ fileID: /^\/test_data\// });
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
