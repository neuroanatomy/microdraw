#!/usr/bin/env node
'use strict';

// One-off fix of the vectorial layers' label sets (maintainer, 2026-11-15).
// Before T002 3.2 the settings offered a stub list ('Set 1', 'set1.json',
// 'set2.json'), so most current projects store a label set that doesn't exist
// ('Set I', 'set1.json', 'set2.json'), or none ('' or null). The viewer uses
// 10 regions for all of them (microdraw.js projectLabelSetURL), while the
// settings show the stored value. This sets them to what is really used:
// every vectorial layer of a current project (`backup` absent) whose `values`
// is neither the file nor the name of a label set in app/public/labels/ gets
// `values: '10regions.json'`. Other layers and known values are not changed.
//
// It changes the current version in place (no new version, no backup), as
// scripts/migrate-projects.js does: the project's content is the same as the
// viewer already shows it.
//
// Dry run by default: prints what it would change and a summary. With
// --apply, it writes. A second run changes nothing.
//   node scripts/fix-label-sets.js --db 127.0.0.1:27017/microdraw-copy
//   node scripts/fix-label-sets.js --db 127.0.0.1:27017/microdraw-copy --apply
// There is no default database, so that it cannot run on one by accident.

const nwlDb = require('neuroweblab/db/db');
const { quietInit } = require('./check-projects');
const { DEFAULT_SOURCE, listLabelSets } = require('../app/controller/api/labelsets');

/**
 * The changes to make: for each current project, the vectorial layers whose
 * label set is unknown
 * @param {object} db Native MongoDB Db
 * @param {object} options { match: a RegExp on shortname (tests), labelSets:
 *   [{name, source}] (default: app/public/labels/) }
 * @returns {Promise<object>} { projects, layers, changes: [{_id, shortname,
 *   fixes: [{index, name, from}]}] }
 */
const planFix = async (db, { match, labelSets } = {}) => {
  const sets = labelSets || await listLabelSets();
  const known = new Set(sets.flatMap(({ name, source }) => [name, source]));
  const query = match ? { backup: { $exists: false }, shortname: { $regex: match } } : { backup: { $exists: false } };
  const projects = await db.collection('projects')
    .find(query, { projection: { shortname: 1, 'annotations.list': 1 } })
    .toArray();
  const vectorial = (project) => (project.annotations && Array.isArray(project.annotations.list) ? project.annotations.list : [])
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer && layer.type === 'vectorial');
  const changes = projects
    .map((project) => ({
      _id: project._id,
      shortname: project.shortname,
      fixes: vectorial(project)
        .filter(({ layer }) => !known.has(layer.values))
        .map(({ layer, index }) => ({ index, name: layer.name, from: typeof layer.values === 'undefined' ? null : layer.values }))
    }))
    .filter(({ fixes }) => fixes.length > 0);
  const layers = projects.reduce((n, project) => n + vectorial(project).length, 0);

  return { projects: projects.length, layers, changes };
};

/**
 * Run the fix and print what it does
 * @param {object} db Native MongoDB Db
 * @param {object} options { apply: write (default: dry run), match,
 *   labelSets: see planFix, print: output function (default console.log) }
 * @returns {Promise<object>} { projects, layers, fixed, errors }
 */
// Set the fixed layers of one project, in its current version: the number of layers set
const applyFixes = async (db, { _id, fixes }) => {
  const $set = Object.fromEntries(fixes.map(({ index }) => [`annotations.list.${index}.values`, DEFAULT_SOURCE]));
  const res = await db.collection('projects').updateOne({ _id, backup: { $exists: false } }, { $set });

  return res.modifiedCount > 0 ? fixes.length : 0;
};

// eslint-disable-next-line max-statements
const fixLabelSets = async (db, { apply = false, match, labelSets, print = console.log } = {}) => {
  const plan = await planFix(db, { match, labelSets });
  const verb = apply ? 'set' : 'would set';
  let fixed = 0;
  let errors = 0;
  for (const change of plan.changes) {
    for (const { name, from } of change.fixes) {
      print(`${change.shortname}: layer ${JSON.stringify(name)}: ${JSON.stringify(from)} → ${verb} ${JSON.stringify(DEFAULT_SOURCE)}`);
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      fixed += apply ? await applyFixes(db, change) : change.fixes.length;
    } catch (error) {
      errors += 1;
      print(`${change.shortname}: error: ${error.message}`);
    }
  }
  const counted = `${fixed} layers ${apply ? 'set' : 'to set'} to ${DEFAULT_SOURCE} in ${plan.changes.length} projects${apply ? '' : ' (dry run, nothing written)'}`;
  print(`\n${plan.projects} current projects, ${plan.layers} vectorial layers, ${counted}, ${errors} errors.`);

  return { projects: plan.projects, layers: plan.layers, fixed, errors };
};

const main = async (dbURL, apply) => {
  try {
    const error = await quietInit(dbURL);
    const db = nwlDb.nativeMongoDB();
    if (db) {
      const { errors } = await fixLabelSets(db, { apply });
      if (errors > 0) {
        process.exitCode = 1;
      }
    } else {
      console.error(`Cannot connect to the database: ${error ? error.message : 'no answer'}`);
      process.exitCode = 1;
    }
  } finally {
    await nwlDb.close();
  }
};

module.exports = { fixLabelSets, planFix };

if (require.main === module) {
  const dbArg = process.argv.indexOf('--db');
  if (dbArg < 0 || !process.argv[dbArg + 1] || process.argv[dbArg + 1].startsWith('--')) {
    console.error('Usage: node scripts/fix-label-sets.js --db <host:port/database> [--apply]');
    process.exitCode = 2;
  } else {
    main(process.argv[dbArg + 1], process.argv.includes('--apply')).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
