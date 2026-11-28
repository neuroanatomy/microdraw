#!/usr/bin/env node
'use strict';

// Which datasets D42 (decisions.md) now refuses (S1d). Reads a list of
// sources, fetches each, and classifies it with the viewer's own readers,
// page-helpers.js tileUrlFunction and parseJSONP:
//   plain                  nothing that looks like code
//   accepted getTileUrl    getTileUrl strings, all read by tileUrlFunction
//   refused getTileUrl     a getTileUrl string tileUrlFunction refuses
//   accepted jsonp         .jsonp files, all of the form f(JSON)
//   refused jsonp          a .jsonp file parseJSONP refuses
//   .js entry              a tileSources address ending in .js, which
//                          OpenSeadragon loads with a <script> (not D42's)
//   not a dataset          an answer that is neither JSON nor DeepZoom
//   not reachable          not http(s), an error status, a network error or a time-out
// A list's entries are classified too: each tileSources object with a
// getTileUrl string, each entry that is a .jsonp address (fetched).
// A source takes the class of its worst entry, in the order above, refused
// first. It prints one line per source, then the number of sources per class;
// never what a dataset holds.
//
// Run it on a person's computer: one request at a time, a delay between them.

const fs = require('fs');
const { tileUrlFunction, parseJSONP, parseDataset, isZarrURL, isCziURL } = require('../app/public/js/page-helpers');

const USAGE = `Usage: node scripts/check-dataset-forms.js [options] <file>

Reads the sources in <file> (- for stdin), one per line; what follows a tab
on a line is ignored (list-dataset-sources.mongosh.js's project counts), and
so are empty lines and lines starting with #.

Options:
  --delay <ms>    pause between requests (default 1000)
  --timeout <ms>  time limit of a request (default 20000)
  --help          this text`;

const CLASSES = [
  'refused getTileUrl', 'refused jsonp', '.js entry', 'not a dataset', 'not reachable',
  'accepted getTileUrl', 'accepted jsonp', 'plain'
];
const MAX_REDIRECTS = 5;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const pathOf = (url) => url.split(/[?#]/)[0];
const isJsonpAddress = (url) => (/\.jsonp$/i).test(pathOf(url));
const isScriptAddress = (url) => (/\.js$/i).test(pathOf(url));

/**
 * The sources a list file names
 * @param {string} text The file
 * @returns {Array<string>} The sources, in order, without duplicates
 */
const readSources = (text) => [
  ...new Set(text.split(/\r?\n/)
    .map((line) => line.split('\t')[0].trim())
    .filter((line) => line !== '' && !line.startsWith('#')))
];

/**
 * @param {string} source An address
 * @returns {URL|null} It, if it is an absolute http(s) address
 */
const httpURL = (source) => {
  try {
    const url = new URL(source);

    return (url.protocol === 'http:' || url.protocol === 'https:') ? url : null;
  } catch (err) {
    return null;
  }
};

/**
 * GET an address, without following a redirect
 * @param {string} url An http(s) address
 * @param {number} timeout The time limit, in ms
 * @returns {Promise<Response>} The answer; rejects with a short reason
 */
const fetchOnce = (url, timeout) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout) })
  .catch((err) => { throw new Error(err.name === 'TimeoutError' ? 'time-out' : 'network error'); });

/**
 * GET an address, following at most 5 redirects
 * @param {string} url An http(s) address
 * @param {number} timeout The time limit of each request, in ms
 * @param {number} [hops] The redirects followed so far
 * @returns {Promise<string>} The answer; rejects with a short reason
 */
const followRedirects = async (url, timeout, hops = 0) => {
  const res = await fetchOnce(url, timeout);
  const location = res.status >= 300 && res.status <= 399 && res.headers.get('location');
  if (!location) {
    if (!res.ok) { throw new Error(`answered ${res.status}`); }

    return res.text();
  }
  const next = new URL(location, url).href;
  if (hops >= MAX_REDIRECTS || !httpURL(next)) {
    throw new Error(hops >= MAX_REDIRECTS ? `more than ${MAX_REDIRECTS} redirects` : 'redirected to an address that is not http(s)');
  }

  return followRedirects(next, timeout, hops + 1);
};

/**
 * GET an address after the pause between requests
 * @param {string} url An http(s) address
 * @param {object} options { delay, timeout } in ms
 * @returns {Promise<string>} The answer; rejects with a short reason
 */
const fetchText = async (url, options) => {
  await sleep(options.delay);

  return followRedirects(url, options.timeout);
};

/**
 * @param {string} code A getTileUrl string
 * @returns {string} Whether tileUrlFunction reads it
 */
const classifyGetTileUrl = (code) => {
  try {
    tileUrlFunction(code);

    return 'accepted getTileUrl';
  } catch (err) {
    return 'refused getTileUrl';
  }
};

/**
 * Classify one entry of a list's tileSources; null for one without code
 * @param {*} entry The entry
 * @param {string} base The list's address
 * @param {object} options { delay, timeout }
 * @returns {string|null|Promise<string>} Its class
 */
const classifyEntry = (entry, base, options) => {
  if (entry && typeof entry === 'object' && typeof entry.getTileUrl === 'string') {
    return classifyGetTileUrl(entry.getTileUrl);
  }
  if (typeof entry !== 'string' || !(isScriptAddress(entry) || isJsonpAddress(entry))) { return null; }
  if (isScriptAddress(entry)) { return '.js entry'; }

  return Promise.resolve()
    // eslint-disable-next-line no-use-before-define -- a .jsonp entry is read as a source
    .then(() => classifyJsonp(new URL(entry, base).href, options))
    .then((found) => found.kind, () => 'not reachable');
};

// the class a source takes: its worst entry's, refused first
const worst = (kinds) => CLASSES.find((c) => kinds.includes(c)) || 'plain';

/**
 * Classify a dataset's entries
 * @param {*} data The parsed dataset
 * @param {string} base Its address
 * @param {object} options { delay, timeout }
 * @returns {Promise<object>} { kind, entries: {class: count} }
 */
const classifyList = async (data, base, options) => {
  const list = data && (data.tileCodeY || data.tileSources);
  const entries = {};
  for (const entry of Array.isArray(list) ? list : []) {
    // eslint-disable-next-line no-await-in-loop -- one request at a time
    const kind = await classifyEntry(entry, base, options);
    if (kind) { entries[kind] = (entries[kind] || 0) + 1; }
  }

  return { kind: worst(Object.keys(entries)), entries };
};

/**
 * Classify a .jsonp source, requested as the viewer does (callback=f)
 * @param {string} url Its address
 * @param {object} options { delay, timeout }
 * @returns {Promise<object>} { kind, entries, reason }
 */
const classifyJsonp = async (url, options) => {
  const text = await fetchText(`${url}${url.includes('?') ? '&' : '?'}callback=f`, options);
  let data;
  try {
    data = parseJSONP(text);
  } catch (err) {
    return { kind: 'refused jsonp', entries: {} };
  }
  const inside = await classifyList(data, url, options);

  return { ...inside, kind: worst([inside.kind, 'accepted jsonp']) };
};

/**
 * Classify a source that is not .jsonp: a JSON list or a DeepZoom image
 * @param {string} url Its address
 * @param {object} options { delay, timeout }
 * @returns {Promise<object>} { kind, entries, reason }
 */
const classifyDataset = async (url, options) => {
  const text = await fetchText(url, options);
  let data;
  try {
    data = parseDataset(text, url);
  } catch (err) {
    // JSON.parse's message quotes the answer: not printed
    return { kind: 'not a dataset', entries: {}, reason: 'neither JSON nor DeepZoom' };
  }

  return classifyList(data, url, options);
};

/**
 * Classify one source
 * @param {string} source The source, as a project lists it
 * @param {object} options { delay, timeout } in ms
 * @returns {Promise<object>} { source, kind, entries: {class: count}, reason }
 */
const classifySource = async (source, options) => {
  const url = httpURL(source);
  if (!url) {
    return { source, kind: 'not reachable', entries: {}, reason: 'not an http(s) address' };
  }
  // read by our own readers, never fetched as a description here
  if (isZarrURL(source) || isCziURL(source)) {
    return { source, kind: 'plain', entries: {}, reason: 'OME-Zarr or CZI, not fetched' };
  }
  try {
    const found = await (isJsonpAddress(url.href) ? classifyJsonp : classifyDataset)(url.href, options);

    return { source, ...found };
  } catch (err) {
    return { source, kind: 'not reachable', entries: {}, reason: err.message };
  }
};

const formatResult = ({ source, kind, entries, reason }) => {
  const counts = Object.keys(entries).map((k) => `${entries[k]} ${k}`);
  const details = counts.concat(reason ? [reason] : []);

  return `${source}\t${kind}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
};

/**
 * Classify every source, one at a time
 * @param {Array<string>} sources The sources
 * @param {object} options { delay, timeout, write } write(line) prints a line
 * @returns {Promise<object>} The number of sources per class
 */
const checkSources = async (sources, options) => {
  const totals = {};
  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop -- one request at a time
    const result = await classifySource(source, options);
    totals[result.kind] = (totals[result.kind] || 0) + 1;
    options.write(formatResult(result));
  }
  options.write('');
  CLASSES.filter((c) => totals[c]).forEach((c) => options.write(`${totals[c]}\t${c}`));
  options.write(`${sources.length}\tsources`);

  return totals;
};

const parseArgs = (argv) => {
  const options = { delay: 1000, timeout: 20000, file: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; } else
    if (arg === '--delay' || arg === '--timeout') {
      i += 1;
      options[arg.slice(2)] = Number(argv[i]);
    } else { options.file = arg; }
  }
  const valid = options.file && Number.isFinite(options.delay) && options.delay >= 0 &&
    Number.isFinite(options.timeout) && options.timeout > 0;

  return { ...options, valid };
};

const main = async (argv) => {
  const options = parseArgs(argv);
  if (options.help || !options.valid) {
    (options.help ? console.log : console.error)(USAGE);

    return options.help ? 0 : 2;
  }
  const text = await fs.promises.readFile(options.file === '-' ? '/dev/stdin' : options.file, 'utf8');
  await checkSources(readSources(text), { ...options, write: (line) => console.log(line) });

  return 0;
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { readSources, classifySource, checkSources, main, CLASSES };
