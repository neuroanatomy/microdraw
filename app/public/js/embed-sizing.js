/**
 * Sizing arithmetic of the embeddable viewer (T002 3.7), as BrainBox's
 * view/shared/embedSizing.js.
 *
 * CommonJS, so that mocha can require it (test/api/embed-sizing.spec.js);
 * in the browser, where there is no `module`, it sets window.EmbedSizing.
 * BrainBox's is bundled by webpack; microdraw's viewer scripts are not.
 *
 * The height an embed needs is computed from the image's aspect ratio, never
 * measured from the DOM: inside an iframe, the document's height is the
 * iframe's, so a measured height could only ever grow.
 */
/* global module */
(function (root) {
  'use strict';

  /**
   * Aspect ratio of the image shown (BrainBox: of the plane shown)
   * @param {object} size The image's size, in pixels
   * @param {number} size.width Width
   * @param {number} size.height Height
   * @returns {number} width/height, or NaN if the size is not known yet
   */
  const imageAspect = function ({ width, height }) {
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
      return NaN;
    }

    return width / height;
  };

  /**
   * Height the host page should give the iframe, so that the image is not
   * letterboxed (the same function as BrainBox's)
   * @param {object} opts Options
   * @param {number} opts.width Content width of the embed, in px
   * @param {number} opts.aspect The image's aspect ratio, from imageAspect()
   * @param {number} opts.toolbarHeight Height of the toolbar below the image, in px
   * @param {number} [opts.minHeight] Never less than this
   * @param {number} [opts.maxHeight] Never more than this
   * @returns {number} Integer height in px, or NaN when the aspect is unknown
   */
  const desiredEmbedHeight = function ({ width, aspect, toolbarHeight, minHeight = 160, maxHeight = Infinity }) {
    if (!isFinite(width) || width <= 0 || !isFinite(aspect) || aspect <= 0) {
      return NaN;
    }

    const bar = isFinite(toolbarHeight) ? toolbarHeight : 0;
    const ideal = Math.round(width / aspect) + bar;

    // a max below the min is contradictory: keep the min, a smaller box
    // cannot show anything useful
    return Math.max(minHeight, Math.min(maxHeight, ideal));
  };

  /**
   * A positive integer query parameter (maxHeight)
   * @param {string} value The raw value
   * @returns {number|undefined} The number, or undefined when unusable
   */
  const positiveIntParam = function (value) {
    const n = parseInt(value, 10);

    // eslint-disable-next-line no-undefined
    return (isFinite(n) && n > 0) ? n : undefined;
  };

  const api = { imageAspect, desiredEmbedHeight, positiveIntParam };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.EmbedSizing = api;
  }
}(typeof window === 'undefined' ? this : window));
