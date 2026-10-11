#!/usr/bin/env node
'use strict';

// Launches the browser the e2e suite uses, once, with Chrome's own output
// shown (dumpio), so a CI failure to start it says why. Run through nyc on
// Node 26 (D20): `npx nyc --silent node scripts/check-browser.js`.

const fs = require('fs');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { launchBrowser } = require('../test/e2e/browser');

const main = async () => {
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
  await fs.promises.access(exe, fs.constants.X_OK);
  console.log(`browser: ${exe}`);
  if (process.platform === 'linux') {
    // eslint-disable-next-line no-sync
    const missing = execFileSync('ldd', [exe]).toString()
      .split('\n')
      .filter((line) => line.includes('not found'));
    console.log(missing.length ? `missing libraries:\n${missing.join('\n')}` : 'ldd: all libraries found');
  }
  const browser = await launchBrowser({ dumpio: true });
  console.log(`launched: ${await browser.version()}`);
  await browser.close();
};

main().catch((err) => {
  console.error(err);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
