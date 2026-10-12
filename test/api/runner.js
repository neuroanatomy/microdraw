const U = require('../mocha.test.util');

// Root hooks for the HTTP tests in test/api: start the app server on a free
// port, with the real test database (MONGODB_TEST), and no browser.

before(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
  this.timeout(U.longTimeout);
  await U.initResources();
});

after(async function () {
  // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
  this.timeout(U.longTimeout);
  await U.closeResources();
});
