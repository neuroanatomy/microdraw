'use strict';
const puppeteer = require('puppeteer');

// MicroDraw and its test fixtures are fully self-hosted, so the E2E specs never
// need to reach the internet. Resolving every non-local host to NOTFOUND makes
// the leftover third-party beacons (analytics) fail instantly instead of hanging,
// which is what `waitUntil: 'networkidle0'` is waiting on. Without this a single
// unreachable CDN turns every navigation into a 30 s timeout.
const OFFLINE_RESOLVER_RULES = 'EXCLUDE localhost, EXCLUDE 127.0.0.1, MAP * ~NOTFOUND';

const launchBrowser = (options = {}) => {
  const { args = [], ...rest } = options;

  return puppeteer.launch({
    headless: 'new',
    ...rest,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--host-resolver-rules=${OFFLINE_RESOLVER_RULES}`,
      ...args
    ]
  });
};

module.exports = { launchBrowser, OFFLINE_RESOLVER_RULES };
