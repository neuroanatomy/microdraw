// Fails when a hex colour appears in the app's CSS (app/public/css/*.css and the <style>
// blocks of app/views/**/*.mustache) other than the few that have no design token yet (listed
// below), or when that CSS uses a --nwl- token that nwl-components/tokens.css doesn't define.
// The colours, fonts, sizes and radii come from the tokens, var(--nwl-…) (UI kit step 5).
// Run by `npm run lint`.
'use strict';
const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tokensFile = require.resolve('nwl-components/tokens.css');

// Hex colours with no token, by file. Each one is a value used nowhere else; a token for it
// comes with the visual refresh (UI kit step 12) or with decision U8 (links).
const untokenised = {
  'app/public/css/microdraw.css': ['#8cf', '#999'],
  'app/public/css/project-style.css': ['#ff8a80', '#e57373'],
  'app/views/admin.mustache': ['#2a2a2a', '#f99', '#aaa', '#f77', '#733', '#a83']
};

// #rgb, #rgba, #rrggbb, #rrggbbaa, not followed by another word character
const hex = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/giu;
const used = /var\(\s*(--nwl-[\w-]+)/gu;

const filesIn = async (dir, ext) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(entries.map((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { return filesIn(file, ext); }

    return entry.name.endsWith(ext) ? [file] : [];
  }));

  return lists.flat();
};

// The lines of a file that hold CSS, with their line numbers: all of a .css file, only the
// <style> blocks of a template (elsewhere, `#` starts URLs and HTML entities).
const cssLines = (file, text) => {
  const lines = text.split('\n').map((line, i) => ({ line, n: i + 1 }));
  if (file.endsWith('.css')) { return lines; }
  let inStyle = false;

  return lines.filter(({ line }) => {
    if ((/<style[\s>]/u).test(line)) { inStyle = true; }
    const keep = inStyle;
    if ((/<\/style>/u).test(line)) { inStyle = false; }

    return keep;
  });
};

const problemsIn = (defined) => async (file) => {
  const name = path.relative(root, file);
  const allowed = new Set((untokenised[name] || []).map((c) => c.toLowerCase()));

  return cssLines(file, await fs.readFile(file, 'utf8')).flatMap(({ line, n }) => {
    const colours = (line.match(hex) || []).filter((c) => !allowed.has(c.toLowerCase()));
    const unknown = [...line.matchAll(used)].map((m) => m[1]).filter((t) => !defined.has(t));

    return [
      ...colours.map((c) => `${name}:${n}: hex colour ${c}`),
      ...unknown.map((t) => `${name}:${n}: ${t} is not defined in nwl-components/tokens.css`)
    ];
  });
};

const main = async () => {
  const tokens = await fs.readFile(tokensFile, 'utf8');
  const defined = new Set([...tokens.matchAll(/(--nwl-[\w-]+)\s*:/gu)].map((m) => m[1]));
  const files = [
    ...await filesIn(path.join(root, 'app/public/css'), '.css'),
    ...await filesIn(path.join(root, 'app/views'), '.mustache')
  ];
  const problems = (await Promise.all(files.map(problemsIn(defined)))).flat();
  if (problems.length > 0) {
    console.error('Use the design tokens of nwl-components/tokens.css (var(--nwl-…)):');
    problems.forEach((p) => console.error(`  ${p}`));
    process.exitCode = 1;
  }
};

main();
