#!/usr/bin/env node
'use strict';

// Dry run of the project validation of M3 (POST /project/json/:projectName,
// decisions D27) over the projects stored in a database: lists the projects
// that their owner could not save again unchanged from the settings page,
// and why. Read-only: it
// never writes to the database.
//
// Run it on a copy of the production database, never on production itself:
//   node scripts/check-projects.js --db 127.0.0.1:27017/microdraw-copy
// There is no default database, so that it cannot run on one by accident.

const monk = require('monk');
const _ = require('lodash');
const { sanitize, structureError, collaboratorName, isAnyone } = require('../app/controller/project/project.validation');

const dbArg = process.argv.indexOf('--db');
if (dbArg < 0 || !process.argv[dbArg + 1]) {
  console.error('Usage: node scripts/check-projects.js --db <host:port/database>');
  process.exitCode = 2;
}

// The project as the settings page sends it back: nwl-components turns files
// stored as plain strings into {source, name}.
const asSentBySettingsPage = (project) => {
  const files = project.files && Array.isArray(project.files.list) ?
    { ...project.files, list: project.files.list.map((f) => (typeof f === 'string' ? { source: f, name: f.slice(f.lastIndexOf('/') + 1) } : f)) } :
    project.files;

  return { ..._.omit(project, ['_id', 'backup']), files };
};

// What re-saving the stored project unchanged would refuse, plus what the
// sanitising would change and the users that do not exist (allowed for a
// stored project, refused for a new one).
// eslint-disable-next-line max-statements
const report = (project, users) => {
  const problems = [];
  const error = structureError(sanitize(asSentBySettingsPage(project)), { shortname: project.shortname, isNew: false });
  if (error) {
    problems.push(`refused: ${error}`);
  }
  if (!_.isEqual(sanitize(project), project)) {
    problems.push('sanitising would change some strings (markup removed)');
  }
  if (typeof project.shortname !== 'string' || !(/^[a-zA-Z0-9]+$/).test(project.shortname)) {
    problems.push('shortname is not alphanumeric (accepted for a stored project, refused for a new one)');
  }
  const list = project.collaborators && Array.isArray(project.collaborators.list) ? project.collaborators.list : [];
  const names = [project.owner, ...list.filter((c) => _.isPlainObject(c) && !isAnyone(c)).map(collaboratorName)];
  const missing = _.uniq(names.filter((name) => !users.has(name)));
  if (missing.length > 0) {
    problems.push(`users that do not exist (kept on save): ${missing.join(', ')}`);
  }

  return problems;
};

// eslint-disable-next-line max-statements
const main = async () => {
  const db = monk(process.argv[dbArg + 1]);
  try {
    const users = new Set(await db.get('users').distinct('username'));
    const projects = await db.get('projects').find({ backup: { $exists: false } });
    let refused = 0;
    for (const project of projects) {
      const problems = report(project, users);
      if (problems.some((p) => p.startsWith('refused'))) {
        refused += 1;
      }
      if (problems.length > 0) {
        console.log(`${project.shortname} (owner ${project.owner}):\n  - ${problems.join('\n  - ')}`);
      }
    }
    console.log(`\n${projects.length} projects, ${refused} could not be saved again unchanged.`);
  } finally {
    await db.close();
  }
};

if (!process.exitCode) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
