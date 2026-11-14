#!/usr/bin/env node
'use strict';

// Backfill of the dataset documents (T002 3.3): every dataset listed in a
// current project (`files.list[].source`, an http(s) URL; plain string
// entries from before files were objects count too) gets its document in
// `datasets` if it has none (app/controller/datasets.js), as the first save
// of a dataset in a project creates it since 3.3:
// - owner: the owner of the oldest current project listing it (oldest by
//   `created`, else by the date of the project's first version, else by _id);
// - name: that project's row name, or the last path segment of the URL
//   without `.json`;
// - included: that project's `created`, else now.
// Documents that exist are not changed: a second run creates nothing. Empty
// and non-http(s) sources (bare file names) get no document: they are listed.
//
// Dry run by default: prints what it would create and a summary. With
// --apply, it writes.
//
// Run it on a copy of the production database first:
//   node scripts/backfill-datasets.js --db 127.0.0.1:27017/microdraw-copy
//   node scripts/backfill-datasets.js --db 127.0.0.1:27017/microdraw-copy --apply
// There is no default database, so that it cannot run on one by accident.

const _ = require('lodash');
const nwlDb = require('neuroweblab/db/db');
const { quietInit } = require('./check-projects');
const { CURRENT, findCurrentProject } = require('../app/controller/project/currentProject');
const { DATASETS, createDatasets, datasetName, fileRows, isDatasetSource } = require('../app/controller/datasets');

// how many sources whose name differs between projects are printed
const NAME_EXAMPLES = 10;

const validDate = (value) => {
  const date = typeof value === 'string' || value instanceof Date ? new Date(value) : null;

  return date && !isNaN(date.getTime()) ? date : null;
};

/**
 * The date a project is ordered by: `created`, else the `modified` of its
 * first version, else the time of that version's _id
 * @param {object} db Native MongoDB Db
 * @param {object} project A current project version
 * @returns {Promise<Date>} The date
 */
const projectDate = async (db, project) => {
  const created = validDate(project.created);
  if (created) {
    return created;
  }
  const first = await db.collection('projects').findOne(
    { shortname: project.shortname },
    { sort: { _id: 1 }, projection: { modified: 1 } }
  );
  const version = first || project;

  return validDate(version.modified) || version._id.getTimestamp();
};

/**
 * Read every current project and the datasets they list
 * @param {object} db Native MongoDB Db
 * @param {object} options { match: a RegExp restricting the shortnames (tests) }
 * @returns {Promise<object>} { projects, rows, sources: Map source ->
 *   [{ shortname, owner, created, date, _id, name }], skipped: [{ shortname,
 *   source }] }
 */
// eslint-disable-next-line max-statements
const readProjects = async (db, { match } = {}) => {
  const query = match ? { ...CURRENT, shortname: { $regex: match } } : CURRENT;
  const shortnames = (await db.collection('projects').distinct('shortname', query))
    .filter((s) => typeof s === 'string')
    .sort();
  const sources = new Map();
  const skipped = [];
  let rows = 0;
  let projects = 0;
  for (const shortname of shortnames) {
    // one project at a time (a 2 150-file project is about 340 KB)
    // eslint-disable-next-line no-await-in-loop
    const project = await findCurrentProject(db, shortname);
    if (project) {
      projects += 1;
      const list = fileRows(project);
      rows += list.length;
      // eslint-disable-next-line no-await-in-loop
      const date = list.length > 0 ? await projectDate(db, project) : null;
      for (const row of list) {
        if (isDatasetSource(row.source)) {
          const listing = { shortname, owner: project.owner, created: validDate(project.created), date, _id: project._id, name: datasetName(row) };
          sources.set(row.source, [...(sources.get(row.source) || []), listing]);
        } else {
          skipped.push({ shortname, source: row.source });
        }
      }
    }
  }

  return { projects, rows, sources, skipped };
};

/**
 * The document a source would get: from the oldest project listing it (its
 * first row there)
 * @param {string} source The dataset's URL
 * @param {Array<object>} listings From readProjects
 * @param {string} now ISO date used when the project has no `created`
 * @returns {object} { source, name, owner, included, from: shortname }
 */
const plannedDocument = (source, listings, now) => {
  const [oldest] = _.sortBy(listings, [(l) => l.date.getTime(), (l) => String(l._id)]);

  return {
    source,
    name: oldest.name,
    owner: typeof oldest.owner === 'string' ? oldest.owner : '',
    included: oldest.created ? oldest.created.toJSON() : now,
    from: oldest.shortname
  };
};

/**
 * What the backfill would do
 * @param {object} db Native MongoDB Db
 * @param {object} options { match: see readProjects }
 * @returns {Promise<object>} { projects, rows, distinct, existing, toCreate:
 *   [document], skipped: [{ shortname, source }], renamed: [{ source, names }] }
 */
const planBackfill = async (db, { match } = {}) => {
  const { projects, rows, sources, skipped } = await readProjects(db, { match });
  const all = [...sources.keys()];
  const existing = new Set((await db.collection(DATASETS).find({ source: { $in: all } }, { projection: { source: 1 } })
    .toArray()).map((d) => d.source));
  const now = (new Date()).toJSON();
  const toCreate = all.filter((s) => !existing.has(s)).sort()
    .map((s) => plannedDocument(s, sources.get(s), now));
  const renamed = all.sort()
    .map((source) => ({ source, names: _.uniq(sources.get(source).map((l) => l.name)) }))
    .filter((r) => r.names.length > 1);

  return { projects, rows, distinct: all.length, existing: existing.size, toCreate, skipped, renamed };
};

/**
 * Run the backfill and print what it does
 * @param {object} db Native MongoDB Db
 * @param {object} options { apply: write (default: dry run), match: see
 *   readProjects, print: output function (default console.log) }
 * @returns {Promise<object>} { projects, rows, distinct, existing, created,
 *   skipped, renamed, errors }
 */
// eslint-disable-next-line max-statements
const backfillDatasets = async (db, { apply = false, match, print = console.log } = {}) => {
  const plan = await planBackfill(db, { match });
  const verb = apply ? 'create' : 'would create';
  for (const doc of plan.toCreate) {
    print(`${verb}: ${doc.source} (name ${JSON.stringify(doc.name)}, owner ${doc.owner}, included ${doc.included}, from ${doc.from})`);
  }
  for (const { shortname, source } of plan.skipped) {
    print(`skipped, not an http(s) URL: ${JSON.stringify(typeof source === 'undefined' ? null : source)} in ${shortname}`);
  }
  if (plan.renamed.length > 0) {
    print(`${plan.renamed.length} datasets have different names in different projects, e.g.:`);
    for (const { source, names } of plan.renamed.slice(0, NAME_EXAMPLES)) {
      print(`  ${source}: ${names.map((n) => JSON.stringify(n)).join(', ')}`);
    }
  }
  let created = 0;
  let errors = 0;
  if (apply) {
    for (const { source, name, owner, included } of plan.toCreate) {
      try {
        // eslint-disable-next-line no-await-in-loop
        created += await createDatasets(db, [{ source, name }], { owner, included });
      } catch (error) {
        errors += 1;
        print(`${source}: error: ${error.message}`);
      }
    }
  }
  const summary = {
    projects: plan.projects,
    rows: plan.rows,
    distinct: plan.distinct,
    existing: plan.existing,
    created: apply ? created : plan.toCreate.length,
    skipped: plan.skipped.length,
    renamed: plan.renamed.length,
    errors
  };
  const done = apply ? `${summary.created} documents created` : `${summary.created} documents to create (dry run, nothing written)`;
  print(`\n${summary.projects} projects, ${summary.rows} file rows, ${summary.distinct} distinct datasets (${summary.existing} with a document already), ${done}, ${summary.skipped} rows skipped (not http(s)), ${summary.renamed} datasets named differently across projects, ${errors} errors.`);

  return summary;
};

const main = async (dbURL, apply) => {
  try {
    const error = await quietInit(dbURL);
    const db = nwlDb.nativeMongoDB();
    if (db) {
      const { errors } = await backfillDatasets(db, { apply });
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

module.exports = { backfillDatasets, planBackfill };

if (require.main === module) {
  const dbArg = process.argv.indexOf('--db');
  if (dbArg < 0 || !process.argv[dbArg + 1] || process.argv[dbArg + 1].startsWith('--')) {
    console.error('Usage: node scripts/backfill-datasets.js --db <host:port/database> [--apply]');
    process.exitCode = 2;
  } else {
    main(process.argv[dbArg + 1], process.argv.includes('--apply')).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
