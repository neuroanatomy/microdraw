'use strict';

/*
  The look of every page comes from nwl-components: its tokens, base styles
  and widgets, and the fonts of its fonts.css (Source Sans 3), which each page
  links from /lib/nwl-components, with the font files beside it.

  UI kit step 13 opted every page in to the kit's 2027 theme, with a
  data-nwl-theme="2027" attribute on <html>. nwl-components 3.0.0 made those
  values the defaults and the attribute a no-op, so step 14 removed it: a page
  now only needs the fonts.css link.

  The home and error pages are not inside .app and don't load base.css: their
  font and colours come from shared-style.css, through the tokens. The viewer
  is in a shadow root (of #content on /data, #microdraw on the project page):
  the tokens inherit into it from <html>, and the @font-face rules of the
  document's fonts.css apply there, so its toolbar is in Source Sans 3 too. In
  a frame on another site, the viewer loads fonts.css from its own origin.
*/
const fs = require('fs/promises');
const path = require('path');
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');
const admins = require('../../app/controller/admin/admins');

const user = { username: 'e2e-look', password: 'e2e-look-password' };
// not an admin: /admin answers it with the error page (403, "Admins only")
const other = { username: 'e2e-look-other', password: 'e2e-look-other-password' };
const project = U.createPublicAnnotationProject('e2elook');
project.owner = user.username;
const CAT = '/test_data/cat.json';

const PAGES = [
  { name: 'ask-for-login (new project, logged out)', path: '/project/new' },
  { name: 'ask-for-login (admin, logged out)', path: '/admin' },
  { name: 'project settings (logged out)', path: `/project/${project.shortname}/settings` },
  { name: 'user (logged out)', path: `/user/${user.username}` },
  { name: 'project settings', path: `/project/${project.shortname}/settings`, login: true },
  { name: 'user', path: `/user/${user.username}`, login: true },
  { name: 'new project', path: '/project/new', login: true },
  { name: 'admin', path: '/admin', login: true },
  { name: 'home', path: '/' },
  { name: 'home (logged in)', path: '/', login: true },
  // all its text is in headings (the stack is shown only in development): only the bold face loads
  { name: 'error (403, Admins only)', path: '/admin', login: true, as: other, font: 'bold 14px' },
  // `viewer`: the shadow root's host
  { name: 'project', path: `/project/${project.shortname}`, viewer: '#microdraw' },
  { name: 'project, with the viewer', path: `/project/${project.shortname}?source=${CAT}&project=${project.shortname}&slice=0`, viewer: '#microdraw' },
  { name: 'project, with the viewer (logged in)', path: `/project/${project.shortname}?source=${CAT}&project=${project.shortname}&slice=0`, login: true, viewer: '#microdraw' },
  { name: 'viewer', path: `/data?source=${CAT}&project=${project.shortname}&slice=0`, viewer: '#content' },
  { name: 'viewer (logged in)', path: `/data?source=${CAT}&project=${project.shortname}&slice=0`, login: true, viewer: '#content' }
];
const VIEWS = path.join(__dirname, '../../app/views');

// In the page: fonts.css and its first font file as the
// server answers them, and the body's font once the fonts are ready (`checked`:
// the size, and weight, of the Source Sans 3 face the page's text uses)
const lookOf = async (checked) => {
  const head = async (url) => {
    const res = await fetch(url, { credentials: 'same-origin' });

    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], text: await res.text() };
  };
  const css = await head('/lib/nwl-components/fonts.css');
  const fontUrl = new URL(css.text.match(/url\("?([^")]+)"?\)/u)[1], new URL('/lib/nwl-components/fonts.css', location.href)).href;
  const font = await head(fontUrl);
  await document.fonts.ready;

  return {
    fontsCss: { status: css.status, type: css.type },
    fontFile: { status: font.status, type: font.type },
    bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0].trim(),
    // check() is also true when no font face of that name exists: the faces from fonts.css
    // must be there, and the body's loaded
    loaded: document.fonts.check(`${checked} "Source Sans 3"`) &&
      [...document.fonts].some((f) => f.family.replace(/"/gu, '') === 'Source Sans 3' && f.status === 'loaded')
  };
};

// In the page: the font of the viewer's toolbar and of its slice number, inside the shadow root
// of `host`, once the viewer has filled it
const viewerFontOf = (host) => {
  const root = document.querySelector(host).shadowRoot;
  const font = (sel) => getComputedStyle(root.querySelector(sel)).fontFamily.split(',')[0].trim();

  return { toolbar: font('#menuBar'), sliceNumber: font('#slice-number'), button: font('#home') };
};
const viewerReady = (host) => {
  const root = document.querySelector(host).shadowRoot;

  return Boolean(root && root.querySelector('#slice-number') && root.querySelector('#slice-number').textContent);
};

const SS3 = '"Source Sans 3"';
// the viewer, in the shadow root of `host` (in `page`, or a frame), has its toolbar in Source Sans 3
const assertViewerFont = async (page, host) => {
  await page.waitForFunction(viewerReady, { polling: 50, timeout: U.mediumTimeout }, host);
  assert.deepEqual(await page.evaluate(viewerFontOf, host), { toolbar: SS3, sliceNumber: SS3, button: SS3 });
};

// In the frame: whether it is on another site than the page holding it, whether its
// fonts.css link and the font requests are on its own origin, and a Source Sans 3 face loaded
const framedLookOf = async () => {
  await document.fonts.ready;
  let crossOrigin = false;
  try { crossOrigin = !window.top.location.href; } catch (err) { crossOrigin = true; }
  const link = document.querySelector('link[href$="nwl-components/fonts.css"]');
  const fonts = performance.getEntriesByType('resource').map((e) => new URL(e.name))
    .filter((u) => u.pathname.startsWith('/lib/nwl-components/fonts'));

  return {
    crossOrigin,
    fontsCss: Boolean(link && link.sheet) && new URL(link.href).origin === location.origin,
    requests: fonts.length > 1 && fonts.every((u) => u.origin === location.origin),
    loaded: [...document.fonts].some((f) => f.family.replace(/"/gu, '') === 'Source Sans 3' && f.status === 'loaded')
  };
};

// Each top-level template of the app (the partials are parts of pages) that lacks the fonts.css
// link, or still sets the attribute nwl-components 3.0.0 no longer reads
const templatesWithoutFonts = async () => {
  const templates = (await fs.readdir(VIEWS)).filter((f) => f.endsWith('.mustache'));
  const texts = await Promise.all(templates.map((f) => fs.readFile(path.join(VIEWS, f), 'utf8')));

  return {
    templates,
    missing: templates.filter((f, i) => !texts[i].includes('href="/lib/nwl-components/fonts.css"') ||
      texts[i].includes('data-nwl-theme'))
  };
};

// In the page: the form controls of the viewer's shadow root (CodeFlask's editor aside) whose
// font family differs from their parent's, after the panels holding them are shown
const controlFontsOf = (host) => {
  const root = document.querySelector(host).shadowRoot;
  for (const id of ['#layers-panel', '#text-annotation-panel', '#labelset-panel', '#add-layer-panel']) {
    root.querySelector(id).style.display = 'block';
  }
  const family = (el) => getComputedStyle(el).fontFamily;
  const controls = [...root.querySelectorAll('button, input, select, textarea')]
    .filter((el) => !el.closest('.codeflask') && el.getClientRects().length > 0);

  return {
    count: controls.length,
    differ: controls.filter((el) => family(el) !== family(el.parentElement))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${family(el).split(',')[0]}`)
  };
};

describe('the kit\'s look on every page: fonts.css and Source Sans 3 (UI kit steps 13, 14)', () => {
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
      await H.logIn(await context.newPage(), other);
    } finally {
      await H.closeContext(context);
    }
  });

  after(async () => {
    admins.setAdmins(previousAdmins);
    await U.removeProject(project.shortname);
  });

  for (const pg of PAGES) {
    it(`${pg.name}: loads fonts.css and its fonts, body in Source Sans 3`, async () => {
      const context = await H.newContext();
      try {
        const page = await context.newPage();
        if (pg.login) { await H.logIn(page, pg.as || user); }
        await page.goto(U.url(pg.path), { waitUntil: 'load' });
        assert.deepEqual(await page.evaluate(lookOf, pg.font || '14px'), {
          fontsCss: { status: 200, type: 'text/css' },
          fontFile: { status: 200, type: 'font/woff2' },
          bodyFont: '"Source Sans 3"',
          loaded: true
        });
        if (pg.viewer) { await assertViewerFont(page, pg.viewer); }
      } finally {
        await H.closeContext(context);
      }
    }).timeout(U.mediumTimeout);
  }

  // the landing page's main heading (h2; the logo is an image) stays centred
  it('home: the main heading stays centred', async () => {
    const context = await H.newContext();
    try {
      const page = await context.newPage();
      await page.goto(U.url('/'), { waitUntil: 'load' });
      assert.equal(await page.$eval('h2', (h) => getComputedStyle(h).textAlign), 'center');
    } finally {
      await H.closeContext(context);
    }
  }).timeout(U.mediumTimeout);

  // the viewer's form controls take the panel's font, not the browser's (Arial)
  it('viewer: every visible form control in the shadow root has its surrounding text\'s font', async () => {
    const context = await H.newContext();
    try {
      const page = await context.newPage();
      await page.goto(U.url(`/data?source=${CAT}&project=${project.shortname}&slice=0`), { waitUntil: 'load' });
      await page.waitForFunction(viewerReady, { polling: 50, timeout: U.mediumTimeout }, '#content');
      const { count, differ } = await page.evaluate(controlFontsOf, '#content');
      assert.isAbove(count, 10, 'the panels\' controls are shown');
      assert.deepEqual(differ, []);
    } finally {
      await H.closeContext(context);
    }
  }).timeout(U.mediumTimeout);

  // every page: each top-level template links fonts.css, without the old theme attribute
  it('every page template links fonts.css', async () => {
    const { templates, missing } = await templatesWithoutFonts();
    assert.includeMembers(templates, ['index.mustache', 'project.mustache', 'data.mustache', 'error.mustache']);
    assert.deepEqual(missing, []);
  });

  // the viewer in a frame on another site (the page on 127.0.0.1, the viewer on localhost):
  // fonts.css and its font files come from the frame's own origin
  it('viewer in a cross-origin frame: loads fonts.css from its own origin', async () => {
    const context = await H.newContext();
    try {
      const page = await context.newPage();
      const viewerURL = U.url(`/data?source=${CAT}&project=${project.shortname}&slice=0`);
      await page.goto(U.url('/').replace('//localhost:', '//127.0.0.1:'), { waitUntil: 'load' });
      await page.evaluate((src) => {
        const frame = document.createElement('iframe');
        frame.src = src;
        frame.style.cssText = 'width:1000px;height:700px';
        document.body.appendChild(frame);
      }, viewerURL);
      const frame = await page.waitForFrame((f) => f.url() === viewerURL, { timeout: U.mediumTimeout });
      await assertViewerFont(frame, '#content');
      assert.deepEqual(await frame.evaluate(framedLookOf), { crossOrigin: true, fontsCss: true, requests: true, loaded: true });
    } finally {
      await H.closeContext(context);
    }
  }).timeout(U.mediumTimeout);
});
