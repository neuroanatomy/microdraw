/**
 * The two request helpers of microdraw's pages (T002 C2, W10): one
 * loadScript and one fetchJSON for the viewer (microdraw.js, on /data and on
 * the project page), the embed page (embed-page.js) and the pages that attach
 * the viewer (data.mustache, project-page.js). Each page loads it with a
 * <script> before its own code; it sets window.PageHelpers.
 *
 * CommonJS too, so that mocha can require it (test/api/page-helpers.spec.js),
 * as embed-sizing.js.
 *
 * fetchJSON keeps the viewer's rules, not nwl-components' fetchJSON: no
 * Content-Type header (a cross-origin GET of a dataset needs no CORS
 * preflight), and only the HTTP status decides an error (a dataset's JSON may
 * hold any `success` key).
 */
/* global module, global */
(function (root) {
  'use strict';

  /**
   * Load a script by adding a <script> to the body
   * @param {string} src The script's URL
   * @returns {Promise<void>} Resolves once it has run; rejects if it cannot be loaded
   */
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = root.document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`cannot load ${src}`));
    root.document.body.appendChild(s);
  });

  /**
   * GET a URL and parse its JSON answer; an error status throws
   * @param {string} url The URL
   * @param {object} [init] fetch's options (the embed page's header)
   * @returns {Promise<any>} The parsed answer; rejects with err.status on an error status
   */
  const fetchJSON = async (url, init) => {
    const res = await root.fetch(url, init);
    if (!res.ok) {
      throw Object.assign(new Error(`${url} answered ${res.status}`), { status: res.status });
    }

    return res.json();
  };

  const api = { loadScript, fetchJSON };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PageHelpers = api;
  }
}(typeof window === 'undefined' ? global : window));
