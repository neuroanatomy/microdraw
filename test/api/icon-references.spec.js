'use strict';

const fs = require('fs');
const path = require('path');
const { assert } = require('chai');

// UI kit step 11b: every icon reference resolves to a file in the repo, so
// no toolbar or page shows a broken image. Reads the sources only (no server,
// no browser). Covers the Mustache views (toolsFull.mustache included), url()
// in app/public/css, and img/ paths in app/public/js and the page scripts
// (the built app/public/js/pages bundles are skipped).

const root = path.join(__dirname, '..', '..');
const publicDir = path.join(root, 'app', 'public');

const IMG = /\.(svg|png|jpe?g|gif|webp|mp4)$/i;
const SRC = /\bsrc\s*=\s*["']([^"']+)["']/g;
const URL_ = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
const JS_IMG = /["'`]((?:\/|\.\/)?img\/[^"'`\s]+)["'`]/g;

const listFiles = async (dir, ext, skip = []) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name);
    if (skip.includes(full)) { return []; }
    if (entry.isDirectory()) { return listFiles(full, ext, skip); }

    return entry.name.endsWith(ext) ? [full] : [];
  }));

  return lists.flat();
};

const withoutQuery = (ref) => ref.split(/[?#]/)[0];

// The local file references in `file` matched by `patterns`
const collect = async (file, patterns) => {
  const text = await fs.promises.readFile(file, 'utf8');
  const refs = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const ref = m[1].trim();
      const external = (/^(data:|#|https?:|\/\/)/).test(ref);
      if (!external && !ref.includes('{{') && !ref.includes('${')) {
        refs.push({ file: path.relative(root, file), ref });
      }
    }
  }

  return refs;
};

const collectAll = async (files, patterns) => (await Promise.all(files.map((f) => collect(f, patterns)))).flat();

// Pages are served from app/public at the site root; /lib/nwl-components is
// the nwl-components dist folder (app.js)
const resolve = (ref) => {
  const clean = withoutQuery(ref);
  const nwl = '/lib/nwl-components/';
  if (clean.startsWith(nwl)) {
    return path.join(path.dirname(require.resolve('nwl-components/tokens.css')), clean.slice(nwl.length));
  }

  return path.join(publicDir, clean.replace(/^\//, ''));
};

const exists = (file) => fs.promises.access(file).then(() => true, () => false);

describe('Icon references (UI kit step 11b)', function () {
  let viewRefs;
  let cssRefs;
  let jsRefs;

  before(async function () {
    const views = await listFiles(path.join(root, 'app', 'views'), '.mustache');
    viewRefs = (await collectAll(views, [SRC, URL_])).filter(({ ref }) => IMG.test(withoutQuery(ref)));

    const css = await listFiles(path.join(publicDir, 'css'), '.css');
    cssRefs = await collectAll(css, [URL_]);

    const js = [
      ...await listFiles(path.join(publicDir, 'js'), '.js', [path.join(publicDir, 'js', 'pages')]),
      ...await listFiles(path.join(root, 'app', 'views', 'scripts', 'src'), '.js')
    ];
    jsRefs = await collectAll(js, [JS_IMG]);
  });

  it('finds the references (toolbar, pages, CSS, JS)', function () {
    assert.isAtLeast(viewRefs.length, 55, 'Mustache image references');
    assert.isAtLeast(viewRefs.filter(({ file }) => file.endsWith('toolsFull.mustache')).length, 40, 'toolbar references');
    assert.isAtLeast(cssRefs.length, 8, 'CSS url() references');
    assert.isAtLeast(jsRefs.length, 3, 'JS img/ references');
  });

  it('every reference points at an existing file', async function () {
    const refs = [...viewRefs, ...cssRefs, ...jsRefs];
    const found = await Promise.all(refs.map(({ ref }) => exists(resolve(ref))));
    const missing = refs.filter((r, i) => !found[i]).map(({ file, ref }) => `${file}: ${ref}`);
    assert.deepEqual(missing, [], 'references to missing files');
  });
});
