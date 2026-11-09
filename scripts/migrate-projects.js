#!/usr/bin/env node
'use strict';

// Migration of the stored projects (T002 2.4): collaborator rows stored
// before 2.2 with one key (`username` or `userID`) get both, equal, as every
// save writes them since 2.2 (withBothKeys, project.validation.js). Nothing
// else changes. A row whose two keys differ, or that names nobody, is
// reported, not changed.
//
// Dry run by default: prints, per project, the rows it would change, and a
// summary. With --apply, each project to change gets a new version
// (saveProjectVersion, the previous one is kept as backup) that keeps the
// previous `modified` and `modifiedBy`: the migration is not a user's edit.
// A project whose current version changed between the read and the write
// (a save by the live app) is skipped and reported; run the script again.
// A second run changes nothing.
//
// Run it on a copy of the production database first:
//   node scripts/migrate-projects.js --db 127.0.0.1:27017/microdraw-copy
//   node scripts/migrate-projects.js --db 127.0.0.1:27017/microdraw-copy --apply
// There is no default database, so that it cannot run on one by accident.

const _ = require('lodash');
const nwlDb = require('neuroweblab/db/db');
const { quietInit } = require('./check-projects');
const { CURRENT, findCurrentProject, saveProjectVersion } = require('../app/controller/project/currentProject');
const { collaboratorName, withBothKeys } = require('../app/controller/project/project.validation');

const collaboratorList = (project) => ((_.isPlainObject(project.collaborators) && Array.isArray(project.collaborators.list)) ?
  project.collaborators.list :
  []);

/**
 * What the migration does to one project
 * @param {object} project A current project version
 * @returns {object} { list: the new collaborator list, changes: [{row, from,
 *   to}], reported: [{row, message}] }
 */
const projectChanges = (project) => {
  const changes = [];
  const reported = [];
  const list = collaboratorList(project).map((row, i) => {
    if (typeof collaboratorName(row) === 'undefined') {
      reported.push({ row: i, message: `row ${i + 1} names nobody: ${JSON.stringify(row)}` });

      return row;
    }
    const migrated = withBothKeys(row);
    if (migrated === row) {
      // withBothKeys returns a row whose keys differ as it is
      reported.push({ row: i, message: `row ${i + 1} has a different username (${row.username}) and userID (${row.userID})` });
    } else if (!_.isEqual(migrated, row)) {
      changes.push({ row: i, from: _.pick(row, ['username', 'userID']), to: _.pick(migrated, ['username', 'userID']) });
    }

    return migrated;
  });

  return { list, changes, reported };
};

/**
 * Read every current project and what the migration would do to it
 * @param {object} db Native MongoDB Db
 * @param {object} options { match: a RegExp restricting the shortnames (tests) }
 * @returns {Promise<Array<object>>} [{ shortname, owner, _id: of the version
 *   read, list, changes, reported }]
 */
const planMigration = async (db, { match } = {}) => {
  const query = match ? { ...CURRENT, shortname: { $regex: match } } : CURRENT;
  const shortnames = (await db.collection('projects').distinct('shortname', query))
    .filter((s) => typeof s === 'string')
    .sort();
  const plan = [];
  for (const shortname of shortnames) {
    // one project at a time (a 2 150-file project is about 340 KB)
    // eslint-disable-next-line no-await-in-loop
    const project = await findCurrentProject(db, shortname);
    if (project) {
      plan.push({ shortname, owner: project.owner, _id: project._id, ...projectChanges(project) });
    }
  }

  return plan;
};

/**
 * Write the new version of one project of the plan, unless its current
 * version changed since the plan was made (re-read first)
 * @param {object} db Native MongoDB Db
 * @param {object} entry An entry of the plan
 * @returns {Promise<string>} 'changed' or 'skipped'
 */
const applyOne = async (db, entry) => {
  const current = await findCurrentProject(db, entry.shortname);
  if (!current || !current._id.equals(entry._id)) {
    return 'skipped';
  }
  const { list } = projectChanges(current);
  await saveProjectVersion(db, { ...current, collaborators: { ...current.collaborators, list } }, { keepModified: true });

  return 'changed';
};

/**
 * Write a new version of each project of the plan that has rows to change,
 * unless its current version changed since the plan was made
 * @param {object} db Native MongoDB Db
 * @param {Array<object>} plan From planMigration
 * @returns {Promise<object>} { changed: [shortname], skipped: [shortname],
 *   errors: [{shortname, error}] }
 */
const applyPlan = async (db, plan) => {
  const result = { changed: [], skipped: [], errors: [] };
  for (const entry of plan.filter((p) => p.changes.length > 0)) {
    try {
      // one project at a time, each re-read just before its write
      // eslint-disable-next-line no-await-in-loop
      result[await applyOne(db, entry)].push(entry.shortname);
    } catch (error) {
      result.errors.push({ shortname: entry.shortname, error });
    }
  }

  return result;
};

const describeEntry = (entry) => {
  const lines = [
    ...entry.changes.map(({ row, from, to }) => `row ${row + 1}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`),
    ...entry.reported.map(({ message }) => `${message}: reported, not changed`)
  ];

  return `${entry.shortname} (owner ${entry.owner}):\n  - ${lines.join('\n  - ')}`;
};

/**
 * Run the migration and print what it does
 * @param {object} db Native MongoDB Db
 * @param {object} options { apply: write (default: dry run), match: see
 *   planMigration, print: output function (default console.log) }
 * @returns {Promise<object>} { scanned, changed, skipped, reported, errors }
 */
// eslint-disable-next-line max-statements
const migrateProjects = async (db, { apply = false, match, print = console.log } = {}) => {
  const plan = await planMigration(db, { match });
  for (const entry of plan.filter((p) => p.changes.length > 0 || p.reported.length > 0)) {
    print(describeEntry(entry));
  }
  const toChange = plan.filter((p) => p.changes.length > 0);
  const reported = _.sumBy(plan, (p) => p.reported.length);
  const rows = _.sumBy(toChange, (p) => p.changes.length);
  let summary = { scanned: plan.length, changed: toChange.length, skipped: 0, reported, rows, errors: 0 };
  if (apply) {
    const result = await applyPlan(db, plan);
    for (const shortname of result.skipped) {
      print(`${shortname}: skipped, changed since it was read (run the script again)`);
    }
    for (const { shortname, error } of result.errors) {
      print(`${shortname}: error: ${error.message}`);
    }
    summary = {
      ...summary,
      changed: result.changed.length,
      rows: _.sumBy(toChange.filter((p) => result.changed.includes(p.shortname)), (p) => p.changes.length),
      skipped: result.skipped.length,
      errors: result.errors.length
    };
  }
  const changed = apply ?
    `${summary.changed} changed (${summary.rows} rows)` :
    `${summary.changed} to change (${summary.rows} rows; dry run, nothing written)`;
  print(`\n${summary.scanned} projects scanned, ${changed}, ${summary.skipped} skipped, ${reported} rows reported, ${summary.errors} errors.`);

  return summary;
};

const main = async (dbURL, apply) => {
  try {
    const error = await quietInit(dbURL);
    const db = nwlDb.nativeMongoDB();
    if (db) {
      const { errors } = await migrateProjects(db, { apply });
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

module.exports = { applyPlan, migrateProjects, planMigration, projectChanges };

if (require.main === module) {
  const dbArg = process.argv.indexOf('--db');
  if (dbArg < 0 || !process.argv[dbArg + 1] || process.argv[dbArg + 1].startsWith('--')) {
    console.error('Usage: node scripts/migrate-projects.js --db <host:port/database> [--apply]');
    process.exitCode = 2;
  } else {
    main(process.argv[dbArg + 1], process.argv.includes('--apply')).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
