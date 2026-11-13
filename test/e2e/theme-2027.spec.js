'use strict';

/*
  UI kit step 13a: the nwl Vue pages (admin, user, project settings, new
  project) and ask-for-login opt in to nwl-components' 2027 theme: <html
  data-nwl-theme="2027"> and the kit's fonts.css, served from
  /lib/nwl-components with the font files beside it. Their body is then in
  Source Sans 3. The other pages (home, project, viewer) stay as they are,
  without the attribute, until steps 13b and 13c.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const user = { username: 'e2e-theme-2027', password: 'e2e-theme-2027-password' };
const project = U.createPublicAnnotationProject('e2etheme2027');
project.owner = user.username;
const CAT = '/test_data/cat.json';

const OPTED = [
  { name: 'ask-for-login (new project, logged out)', path: '/project/new' },
  { name: 'ask-for-login (admin, logged out)', path: '/admin' },
  { name: 'project settings (logged out)', path: `/project/${project.shortname}/settings` },
  { name: 'user (logged out)', path: `/user/${user.username}` },
  { name: 'project settings', path: `/project/${project.shortname}/settings`, login: true },
  { name: 'user', path: `/user/${user.username}`, login: true },
  { name: 'new project', path: '/project/new', login: true },
  { name: 'admin', path: '/admin', login: true }
];
const NOT_OPTED = [
  { name: 'home', path: '/' },
  { name: 'project', path: `/project/${project.shortname}` },
  { name: 'viewer', path: `/data?source=${CAT}&project=${project.shortname}&slice=0` }
];

// In the page: the theme attribute, fonts.css and its first font file as the
// server answers them, and the body's font once the fonts are ready
const themeOf = async () => {
  const head = async (url) => {
    const res = await fetch(url, { credentials: 'same-origin' });

    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], text: await res.text() };
  };
  const css = await head('/lib/nwl-components/fonts.css');
  const fontUrl = new URL(css.text.match(/url\("?([^")]+)"?\)/u)[1], new URL('/lib/nwl-components/fonts.css', location.href)).href;
  const font = await head(fontUrl);
  await document.fonts.ready;

  return {
    theme: document.documentElement.getAttribute('data-nwl-theme'),
    fontsCss: { status: css.status, type: css.type },
    fontFile: { status: font.status, type: font.type },
    bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0].trim(),
    // check() is also true when no font face of that name exists: the faces from fonts.css
    // must be there, and the body's loaded
    loaded: document.fonts.check('14px "Source Sans 3"') &&
      [...document.fonts].some((f) => f.family.replace(/"/gu, '') === 'Source Sans 3' && f.status === 'loaded')
  };
};

describe('2027 theme on the nwl pages (UI kit step 13a)', () => {
  let previousAdmins;

  before(async () => {
    previousAdmins = admins.getAdmins();
    admins.setAdmins([user.username]);
    await U.removeProject(project.shortname);
    await U.insertProject({ ...project });
    // signs the user up, so that its user page exists for the logged-out visit
    const context = await H.newContext();
    try {
      await H.logIn(await context.newPage(), user);
    } finally {
      await H.closeContext(context);
    }
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    await U.removeProject(project.shortname);
  });

  for (const pg of OPTED) {
    it(`${pg.name}: opts in, loads fonts.css and its fonts, body in Source Sans 3`, async () => {
      const context = await H.newContext();
      try {
        const page = await context.newPage();
        if (pg.login) { await H.logIn(page, user); }
        await page.goto(U.url(pg.path), { waitUntil: 'load' });
        assert.deepEqual(await page.evaluate(themeOf), {
          theme: '2027',
          fontsCss: { status: 200, type: 'text/css' },
          fontFile: { status: 200, type: 'font/woff2' },
          bodyFont: '"Source Sans 3"',
          loaded: true
        });
      } finally {
        await H.closeContext(context);
      }
    }).timeout(U.mediumTimeout);
  }

  for (const pg of NOT_OPTED) {
    it(`${pg.name}: has no theme attribute`, async () => {
      const context = await H.newContext();
      try {
        const page = await context.newPage();
        await page.goto(U.url(pg.path), { waitUntil: 'domcontentloaded' });
        assert.isNull(await page.evaluate(() => document.documentElement.getAttribute('data-nwl-theme')));
      } finally {
        await H.closeContext(context);
      }
    }).timeout(U.mediumTimeout);
  }
});
