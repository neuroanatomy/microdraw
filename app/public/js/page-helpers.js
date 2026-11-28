/**
 * The request helpers of microdraw's pages (T002 C2, W10): loadScript,
 * fetchJSON and the reading of what a ?source= address names, for the viewer (microdraw.js, on /data and on
 * the project page), the embed page (embed-page.js) and the pages that attach
 * the viewer (data.mustache, project-page.js). Each page loads it with a
 * <script> before its own code; it sets window.PageHelpers.
 *
 * CommonJS too, for the server's /getJson and so that mocha can require it
 * (test/api/page-helpers.spec.js).
 *
 * fetchJSON keeps the viewer's rules, not nwl-components' fetchJSON: no
 * Content-Type header (a cross-origin GET of a dataset needs no CORS
 * preflight), and only the HTTP status decides an error (a dataset's JSON may
 * hold any `success` key).
 */
/* global module, global */
// eslint-disable-next-line max-statements -- one small closure of helpers
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

  /*
    What an address names, so that users need not know: a JSON list of images
    ({tileSources}), or one image. One DeepZoom image is recognised by what the
    address answers (a .dzi, or a tile service's address), an OME-Zarr store,
    a folder, by its name. So is a CZI file, which is never fetched here (it is
    gigabytes): the CZI service reads it and answers a DeepZoom description.
  */
  const OME_ZARR_READER = '/lib/omezarr-tilesource/omezarr-tilesource.js';

  /**
   * @param {string} url An address
   * @returns {boolean} Whether it names an OME-Zarr store
   */
  const isZarrURL = (url) => (/\.(zarr|ozx)\/?([?#]|$)/i).test(url);

  /**
   * @param {string} url An address
   * @returns {boolean} Whether it names a CZI file
   */
  const isCziURL = (url) => (/^[^?#]*\.czi([?#]|$)/i).test(url);

  /**
   * The address answering a CZI image's DeepZoom description: on the CZI
   * service (window.MICRODRAW_CZI_SERVICE) with the file's whole address, or
   * the address itself when it is already on the service (its local files).
   * Annotations stay under the file's own address.
   * @param {string} url The file's address
   * @param {string} [base] What relative addresses are relative to (the page)
   * @returns {string} The description's address; throws without a CZI service
   */
  const cziAddress = (url, base) => {
    const service = String(root.MICRODRAW_CZI_SERVICE || '').replace(/\/+$/, '');
    if (!service) {
      throw new Error('no CZI service is configured, so this CZI file cannot be opened');
    }
    // outside a browser (the tests), absolute addresses need no base
    const page = base || (root.location && root.location.href);
    const file = new URL(url, page).href;
    if (file.startsWith(`${new URL(service, page).href.replace(/\/+$/, '')}/`)) {
      return url;
    }
    const bytes = new TextEncoder().encode(file);
    const id = root.btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/[=]+$/, '');

    return `${service}/remote/${id}.dzi`;
  };

  const oneImage = (tileSource) => ({ tileSources: [tileSource] });
  const zarrSource = (url) => ({ type: 'ome-zarr', url });

  /**
   * A DeepZoom description as a list of that one image, with the pixel size
   * if it has a PixelsPerMeter attribute (DeepZoom itself has no pixel size)
   * @param {string} text What the address answered
   * @param {string} url The address
   * @returns {object|null} The list, or null if this is no DeepZoom description
   */
  const datasetOfDzi = (text, url) => {
    const xml = text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '').trim();
    const image = xml.match(/^<Image\b([^>]*)>/);
    if (!image || !(/\sTileSize\s*=/).test(image[1]) || !(/<Size\b/).test(xml)) {
      return null;
    }
    const dataset = oneImage(url);
    const pixels = image[1].match(/\sPixelsPerMeter\s*=\s*["']([^"']*)["']/);
    if (pixels && Number(pixels[1]) > 0) {
      dataset.pixelsPerMeter = Number(pixels[1]);
    }

    return dataset;
  };

  /**
   * @param {string} text What the address answered
   * @param {string} url The address
   * @returns {object} The list of images; throws if the text is neither a JSON
   *   list nor a DeepZoom description (JSON.parse's SyntaxError if not JSON)
   */
  const parseDataset = (text, url) => datasetOfDzi(text, url) || JSON.parse(text.replace(/^\uFEFF/, ''));

  /**
   * The list of images an address names. An OME-Zarr store is not fetched.
   * @param {string} url The address
   * @param {object} [init] fetch's options
   * @returns {Promise<object>} The list; rejects with err.status on an error status
   */
  const fetchDataset = async (url, init) => {
    if (isZarrURL(url)) {
      return oneImage(zarrSource(url));
    }
    const czi = isCziURL(url);
    const address = czi ? cziAddress(url) : url;
    const res = await root.fetch(address, init);
    if (!res.ok) {
      // the CZI service says why in its answer
      const reason = czi ? `: ${(await res.text()).slice(0, 200)}` : '';
      throw Object.assign(new Error(`${url} answered ${res.status}${reason}`), { status: res.status });
    }

    return parseDataset(await res.text(), address);
  };

  /*
    A dataset is data from anywhere, so nothing in it is run. Two formats look
    like code: getTileUrl strings and .jsonp files. They are read here.
  */
  const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
  // function (a, b, c) { return ...; }
  const URL_FUNCTION = /^\s*function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^()]*)\)\s*\{\s*return\b([\s\S]*?);?\s*\}\s*;?\s*$/;
  // a template string, a quoted string or a name, and what follows it
  const URL_TERM = /\s*(?:`((?:[^`\\$]|\$(?!\{)|\$\{\s*[A-Za-z_$][\w$]*\s*\})*)`|"([^"\\\n]*)"|'([^'\\\n]*)'|([A-Za-z_$][\w$]*))\s*(\+|$)/y;
  const MAX_CODE = 2000;

  const unsupported = () => new Error('getTileUrl is not supported: it can only be a function returning ' +
    'text made of strings and its arguments (level, x, y)');

  // the pieces of one term: texts, and the positions of arguments
  const termPieces = (match, argument) => {
    const [, template, double, single, name] = match;
    if (typeof name !== 'undefined') {
      return [argument(name)];
    }
    if (typeof template === 'undefined') {
      return [typeof double === 'undefined' ? single : double];
    }

    // split on ${name}: every second piece is a name
    return template.split(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/).map((piece, i) => (i % 2 ? argument(piece) : piece));
  };

  /**
   * A tile source's getTileUrl, given as a string: read, never evaluated
   * @param {string} code Such as "function(l, x, y) { return `a/${l}/${x}_${y}.jpg` }"
   * @returns {Function} The function it describes; throws if it is anything else
   */
  // eslint-disable-next-line max-statements -- one short parser, kept in one place
  const tileUrlFunction = (code) => {
    const found = code.length <= MAX_CODE && code.match(URL_FUNCTION);
    if (!found) {
      throw unsupported();
    }
    const [, parameters, returned] = found;
    const names = parameters.split(',').map((n) => n.trim())
      .filter(Boolean);
    if (!names.every((n) => IDENTIFIER.test(n))) {
      throw unsupported();
    }
    const argument = (name) => {
      const index = names.indexOf(name);
      if (index < 0) {
        throw unsupported();
      }

      return index;
    };
    const body = returned.trim();
    const terms = [];
    let more = '+';
    URL_TERM.lastIndex = 0;
    while (more === '+') {
      const match = URL_TERM.exec(body);
      if (!match) {
        throw unsupported();
      }
      const [, , , , name, next] = match;
      terms.push({ isName: typeof name !== 'undefined', pieces: termPieces(match, argument) });
      more = next;
    }
    // JavaScript would add two numbers that come first, not join them
    if (terms.length > 1 && terms[0].isName && terms[1].isName) {
      throw unsupported();
    }
    const pieces = terms.flatMap((term) => term.pieces);

    return (...args) => pieces.map((p) => (typeof p === 'number' ? String(args[p]) : p)).join('');
  };

  /**
   * A .jsonp file's data
   * @param {string} text The file: f(JSON), comments before it allowed
   * @returns {any} The JSON; throws if the file is anything else
   */
  const parseJSONP = (text) => {
    const found = text.replace(/^\uFEFF/, '').trim()
      .replace(/^(\/\*(?:(?!\*\/)[\s\S])*\*\/\s*)+/, '')
      .match(/^f\s*\(([\s\S]*)\)\s*;?$/);
    if (!found) {
      throw new Error('this .jsonp file is not of the form f(JSON)');
    }

    return JSON.parse(found[1]);
  };

  const withTileUrlFunction = (source) => (source && typeof source.getTileUrl === 'string'
    ? { ...source, getTileUrl: tileUrlFunction(source.getTileUrl) }
    : source);

  /**
   * Make a list's entries ready for OpenSeadragon: an OME-Zarr store may be
   * named by its address alone, its reader (1.6 MB) is loaded only when there
   * is one, and it needs absolute addresses (it uses `new URL(url)`)
   * @param {Array} tileSources The list's entries
   * @param {Function} load Loads a script, resolving once it has run
   * @param {string} base What relative addresses are relative to
   * @returns {Promise<Array>} The entries
   */
  const prepareTileSources = async (tileSources, load, base) => {
    const sources = tileSources.map((s) => {
      if (typeof s !== 'string') { return withTileUrlFunction(s); }
      if (isZarrURL(s)) { return zarrSource(s); }

      return isCziURL(s) ? cziAddress(s, base) : s;
    });
    const stores = sources.filter((s) => s && typeof s === 'object' &&
      (s.type === 'ome-zarr' || isZarrURL(s.url || '')));
    if (stores.length > 0) {
      await load(OME_ZARR_READER);
      stores.filter((s) => s.url).forEach((s) => { s.url = new URL(s.url, base).href; });
    }

    return sources;
  };

  const api = {
    loadScript,
    fetchJSON,
    isZarrURL,
    isCziURL,
    cziAddress,
    parseDataset,
    fetchDataset,
    prepareTileSources,
    tileUrlFunction,
    parseJSONP
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PageHelpers = api;
  }
}(typeof window === 'undefined' ? global : window));
