const assert = require('assert');
const U = require('../mocha.test.util');
const H = require('./helpers');

describe('mocha works', () => {
  it('mocha works', () => {
    assert(true);
  });
});

// Reads the annotations through the app's own database connection (U). It used
// to call neuroweblab's init a second time, which replaced the module-wide
// connection the server uses and closed it: a spec running after this one then
// left a connection open and the run never exited (found in H3).
describe('annotation saved by puppeteer can be retrieved', () => {
  it('works', async () => {
    const annotations = await U.findAnnotations({ user: H.annotator.username });
    annotations.forEach((a) => {
      const [, { segments }] = a && a.annotation && a.annotation.path;
      if (segments) {
        segments.forEach((s) => {
          assert(Array.isArray(s));
        });
      } else {
        assert(false);
      }
    });
  });
});
