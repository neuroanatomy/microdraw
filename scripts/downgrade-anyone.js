#!/usr/bin/env node
'use strict';

// One-off (maintainer, 2026-11-15): "for safety, downgrade all 'anyone' rights
// across projects to only view; projects invisible to 'anyone' stay as they
// are". Since 2026-11-15 a project's settings are saved by per-list rights, so
// an 'anyone' row with annotations 'edit' (given so that any logged-in user can
// draw) would also let any logged-in user change the project's layers.
//
// For every current project (`backup` absent), the 'anyone' row's rights on
// files, annotations and collaborators that are above `view` (edit, add,
// remove) become `view`. `none` and `view` are not changed, and neither are
// the named collaborators' rows. The current version is changed in place (no
// new version), as scripts/fix-label-sets.js does; the dry run's output lists
// every old value.
//
// Dry run by default; --apply writes. A second run changes nothing.
//   node scripts/downgrade-anyone.js --db 127.0.0.1:27017/microdraw-copy
//   node scripts/downgrade-anyone.js --db 127.0.0.1:27017/microdraw-copy --apply
// There is no default database, so that it cannot run on one by accident.

const nwlDb = require('neuroweblab/db/db');
const { quietInit } = require('./check-projects');

const LISTS = ['files', 'annotations', 'collaborators'];
const ABOVE_VIEW = ['edit', 'add', 'remove'];
const isAnyone = (c) => Boolean(c) && (c.username === 'anyone' || c.userID === 'anyone');

/**
 * The changes to make: for each current project, its 'anyone' row's index and
 * the rights above view
 * @param {object} db Native MongoDB Db
 * @param {object} options { match: a RegExp on shortname (tests) }
 * @returns {Promise<object>} { projects, withAnyone, changes: [{_id, shortname,
 *   index, fixes: [{list, from}]}] }
 */
const planDowngrade = async (db, { match } = {}) => {
  const query = match ? { backup: { $exists: false }, shortname: { $regex: match } } : { backup: { $exists: false } };
  const projects = await db.collection('projects')
    .find(query, { projection: { shortname: 1, 'collaborators.list': 1 } })
    .toArray();
  const rows = projects.map((project) => {
    const list = (project.collaborators && Array.isArray(project.collaborators.list)) ? project.collaborators.list : [];
    const index = list.findIndex(isAnyone);

    return { project, index, access: index >= 0 ? (list[index].access || {}) : null };
  });
  const changes = rows
    .filter(({ access }) => access !== null)
    .map(({ project, index, access }) => ({
      _id: project._id,
      shortname: project.shortname,
      index,
      fixes: LISTS.filter((list) => ABOVE_VIEW.includes(access[list])).map((list) => ({ list, from: access[list] }))
    }))
    .filter(({ fixes }) => fixes.length > 0);

  return { projects: projects.length, withAnyone: rows.filter(({ access }) => access !== null).length, changes };
};

// Set one project's 'anyone' rights to view, in its current version: the number of rights set
const applyDowngrade = async (db, { _id, index, fixes }) => {
  const $set = Object.fromEntries(fixes.map(({ list }) => [`collaborators.list.${index}.access.${list}`, 'view']));
  const res = await db.collection('projects').updateOne({ _id, backup: { $exists: false } }, { $set });

  return res.modifiedCount > 0 ? fixes.length : 0;
};

/**
 * Run the downgrade and print what it does
 * @param {object} db Native MongoDB Db
 * @param {object} options { apply: write (default: dry run), match, print:
 *   output function (default console.log) }
 * @returns {Promise<object>} { projects, withAnyone, projectsChanged, rights, errors }
 */
// eslint-disable-next-line max-statements
const downgradeAnyone = async (db, { apply = false, match, print = console.log } = {}) => {
  const plan = await planDowngrade(db, { match });
  const verb = apply ? 'set' : 'would set';
  let rights = 0;
  let errors = 0;
  for (const change of plan.changes) {
    print(`${change.shortname}: anyone ${change.fixes.map(({ list, from }) => `${list} ${from}`).join(', ')} → ${verb} view`);
    try {
      // eslint-disable-next-line no-await-in-loop
      rights += apply ? await applyDowngrade(db, change) : change.fixes.length;
    } catch (error) {
      errors += 1;
      print(`${change.shortname}: error: ${error.message}`);
    }
  }
  const counted = `${rights} rights ${apply ? 'set' : 'to set'} to view in ${plan.changes.length} projects${apply ? '' : ' (dry run, nothing written)'}`;
  print(`\n${plan.projects} current projects, ${plan.withAnyone} with an 'anyone' row, ${counted}, ${errors} errors.`);

  return { projects: plan.projects, withAnyone: plan.withAnyone, projectsChanged: plan.changes.length, rights, errors };
};

const main = async (dbURL, apply) => {
  try {
    const error = await quietInit(dbURL);
    const db = nwlDb.nativeMongoDB();
    if (db) {
      const { errors } = await downgradeAnyone(db, { apply });
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

module.exports = { downgradeAnyone, planDowngrade };

if (require.main === module) {
  const dbArg = process.argv.indexOf('--db');
  if (dbArg < 0 || !process.argv[dbArg + 1] || process.argv[dbArg + 1].startsWith('--')) {
    console.error('Usage: node scripts/downgrade-anyone.js --db <host:port/database> [--apply]');
    process.exitCode = 2;
  } else {
    main(process.argv[dbArg + 1], process.argv.includes('--apply')).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
