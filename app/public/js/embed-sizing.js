/**
 * The image's aspect ratio, for the embeddable viewer's sizing (T002 3.7), as
 * BrainBox's planeAspect (view/shared/embedSizing.js). The height asked for,
 * desiredEmbedHeight, and positiveIntParam are nwl-components' (embed build,
 * the global nwlComponentsEmbed; nwl-components/embed in node).
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

  const api = { imageAspect };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.EmbedSizing = api;
  }
}(typeof window === 'undefined' ? this : window));
