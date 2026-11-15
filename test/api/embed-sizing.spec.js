'use strict';

const { assert } = require('chai');
const { imageAspect, desiredEmbedHeight, positiveIntParam } = require('../../app/public/js/embed-sizing');

// The embed's sizing arithmetic (T002 3.7), as BrainBox's embedSizing: the
// height asked for is computed, never measured. No server, no browser.
describe('Embed sizing (T002 3.7)', function () {
  it('imageAspect: width over height, NaN while the size is unknown', function () {
    assert.equal(imageAspect({ width: 800, height: 400 }), 2);
    for (const size of [{ width: 0, height: 400 }, { width: 800, height: -1 }, { width: NaN, height: 1 }, {}]) {
      assert.isNaN(imageAspect(size), JSON.stringify(size));
    }
  });

  it('desiredEmbedHeight: the width over the aspect, plus the toolbar', function () {
    assert.equal(desiredEmbedHeight({ width: 560, aspect: 2, toolbarHeight: 32 }), 312);
    // goes down as well as up
    assert.equal(desiredEmbedHeight({ width: 560, aspect: 0.5, toolbarHeight: 32 }), 1152);
    assert.equal(desiredEmbedHeight({ width: 333, aspect: 1.5, toolbarHeight: 0 }), 222);
    // an unknown toolbar counts as none
    assert.equal(desiredEmbedHeight({ width: 400, aspect: 1, toolbarHeight: NaN }), 400);
  });

  it('desiredEmbedHeight: within minHeight and maxHeight, the min winning', function () {
    assert.equal(desiredEmbedHeight({ width: 560, aspect: 0.5, toolbarHeight: 32, maxHeight: 600 }), 600);
    assert.equal(desiredEmbedHeight({ width: 100, aspect: 10, toolbarHeight: 0 }), 160);
    assert.equal(desiredEmbedHeight({ width: 100, aspect: 10, toolbarHeight: 0, minHeight: 50, maxHeight: 40 }), 50);
  });

  it('desiredEmbedHeight: NaN without a width or an aspect', function () {
    assert.isNaN(desiredEmbedHeight({ width: 0, aspect: 1, toolbarHeight: 0 }));
    assert.isNaN(desiredEmbedHeight({ width: 500, aspect: NaN, toolbarHeight: 0 }));
  });

  it('positiveIntParam: maxHeight as a positive integer, or undefined', function () {
    assert.equal(positiveIntParam('600'), 600);
    for (const value of ['0', '-5', 'abc', '', null]) {
      assert.isUndefined(positiveIntParam(value), String(value));
    }
  });
});
