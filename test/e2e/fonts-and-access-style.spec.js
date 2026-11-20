'use strict';

/*
  T002 R2b: microdraw's own copies of what nwl-components provides are gone.

  - app/public/lib/roboto/ (Roboto 100, latin + latin-ext): nwl-components 3.7.1's
    fonts.css has both faces, and every page that linked the copy links it.
  - app/public/css/access-style.css: nwl's Access.vue draws the same icons (the same
    SVG files, as data URIs) at the same size in its scoped CSS. Only its
    `.access { padding-top: 5px }` was not in nwl (whose CSS, in a layer, lost to it):
    it moved to projectSettings-style.css. The values below are those measured on
    the settings page before the removal.
*/
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const H = require('./helpers');

const owner = { username: 'e2e-r2b-owner', password: 'e2e-r2b-owner-password' };
const SHORTNAME = 'e2er2bfonts';
const NAME = 'Łódź';

// The icon nwl draws for each button, by the row's level (0 none … 4 remove)
const ICONS = {
  view: ['eye', 'eye-circle', 'eye-circle', 'eye-circle', 'eye-circle'],
  edit: ['pencil', 'pencil', 'pencil-circle', 'pencil-circle', 'pencil-circle'],
  add: ['plus-small', 'plus-small', 'plus-small', 'plus-small-circle', 'plus-small-circle'],
  remove: ['minus-small', 'minus-small', 'minus-small', 'minus-small', 'minus-small-circle']
};

const project = () => {
  const p = U.createProjectWithPermission(SHORTNAME, {});
  p.name = NAME;
  p.owner = owner.username;
  // one widget per level, 0 to 4
  p.collaborators.list = [
    { username: 'anyone', name: 'Any User', access: { collaborators: 'none', annotations: 'view', files: 'edit' } },
    { username: 'e2e-r2b-other', name: 'Other', access: { collaborators: 'add', annotations: 'remove', files: 'view' } }
  ];

  return p;
};

// In the page: each access widget's box, and its buttons' ::before boxes and the SVG text
// behind their background-image (a data URI or a file)
const readWidgets = (els) => {
  const svgOf = async (bg) => {
    const [, src] = bg.match(/^url\("(.*)"\)$/u);

    return (await fetch(src)).text();
  };
  const buttonOf = async (b) => {
    const before = getComputedStyle(b, '::before');

    return {
      name: b.className,
      svg: await svgOf(before.backgroundImage),
      box: [before.width, before.height, before.backgroundSize, before.display, before.content]
    };
  };

  return Promise.all(els.map(async (el) => {
    const s = getComputedStyle(el);

    return {
      level: Number(el.dataset.level),
      box: [s.paddingTop, s.display, s.borderTopStyle, s.textDecorationLine, el.getBoundingClientRect().height],
      buttons: await Promise.all([...el.querySelectorAll('button')].map(buttonOf))
    };
  }));
};

// The icon files, fetched in the page
const iconText = (page, name) => page.evaluate(async (n) => (await fetch(`/lib/nwl-components/icons/${n}.svg`)).text(), name);

// One widget as measured before the removal: its box, its four buttons, their icons
const checkWidget = async (page, w) => {
  assert.deepEqual(w.box, ['5px', 'flex', 'none', 'none', 25], `level ${w.level}`);
  assert.deepEqual(w.buttons.map((b) => b.name), ['view', 'edit', 'add', 'remove']);
  const icons = await Promise.all(w.buttons.map((b) => iconText(page, ICONS[b.name][w.level])));
  w.buttons.forEach((b, i) => {
    assert.deepEqual(b.box, ['15px', '15px', '15px 15px', 'block', '""'], `${b.name} at level ${w.level}`);
    assert.equal(b.svg, icons[i], `${b.name} icon at level ${w.level}`);
  });
};

describe('Fonts and access icons from nwl-components (T002 R2b)', () => {
  let context;
  let page;
  const requested = [];

  before(async () => {
    await U.removeProject(SHORTNAME);
    await U.insertProject(project());
    context = await H.newContext();
    page = await context.newPage();
    page.on('request', (req) => requested.push(new URL(req.url()).pathname));
    await H.logIn(page, owner);
  });

  after(async () => {
    try {
      await H.closeContext(context);
    } finally {
      await U.removeProject(SHORTNAME);
      await U.removeLocalUser(owner.username);
    }
  });

  it('the settings page draws the access icons as before', async () => {
    await page.goto(U.url(`/project/${SHORTNAME}/settings`), { waitUntil: 'load' });
    await page.waitForSelector('.access button', { timeout: U.shortTimeout });
    const widgets = await page.$$eval('.access', readWidgets);
    assert.deepEqual([...new Set(widgets.map((w) => w.level))].sort(), [0, 1, 2, 3, 4]);
    await Promise.all(widgets.map((w) => checkWidget(page, w)));
    assert.notInclude(requested, '/css/access-style.css');
  }).timeout(U.mediumTimeout);

  it('the project page shows the name in Roboto 100, latin-ext included', async () => {
    requested.length = 0;
    await page.goto(U.url(`/project/${SHORTNAME}`), { waitUntil: 'load' });
    const font = await page.evaluate(async (name) => {
      const title = [...document.querySelectorAll('#fontLogo a.titleFont')].find((a) => a.textContent.trim() === name);
      const s = getComputedStyle(title);
      // loads the faces the name needs, as drawing it does
      const loaded = await document.fonts.load(`${s.fontWeight} 16px Roboto`, name);

      return {
        family: s.fontFamily.split(',')[0].trim()
          .replace(/["']/gu, ''),
        weight: s.fontWeight,
        loaded: loaded.map((f) => [f.family.replace(/["']/gu, ''), f.weight, f.status]),
        // a face that covers Ł (U+0141) is among them
        latinExt: loaded.some((f) => (/U\+100-2BA/u).test(f.unicodeRange)),
        check: document.fonts.check('100 16px Roboto', name)
      };
    }, NAME);
    assert.equal(font.family, 'Roboto');
    assert.equal(font.weight, '100');
    assert.isTrue(font.latinExt, JSON.stringify(font.loaded));
    assert.isTrue(font.loaded.every(([family, weight, status]) => family === 'Roboto' && weight === '100' && status === 'loaded'));
    assert.isTrue(font.check);
    assert.isEmpty(requested.filter((p) => p.startsWith('/lib/roboto/')));
    assert.include(requested, '/lib/nwl-components/fonts/roboto-latin-ext-100-normal.woff2');
  }).timeout(U.mediumTimeout);
});
