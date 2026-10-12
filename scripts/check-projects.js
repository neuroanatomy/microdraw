#!/usr/bin/env node
'use strict';

// Dry run of the project validation of M3 (POST /project/json/:projectName,
// decisions D27, D27a) over the projects stored in a database: lists the
// projects that their owner could not save again unchanged from the settings
// page, and why, with the warnings (stored rows that would be refused if they
// were new, sanitising, shortnames, users that do not exist). Read-only: it
// never writes to the database.
//
// The check itself is app/controller/project/project.check.js, the same code
// as the admin section "Projects that don't validate" (A2, decisions D29).
//
// Run it on a copy of the production database, never on production itself:
//   node scripts/check-projects.js --db 127.0.0.1:27017/microdraw-copy
// There is no default database, so that it cannot run on one by accident.

const monk = require('monk');
const { checkStoredProjects, formatProblem } = require('../app/controller/project/project.check');

const main = async (dbURL) => {
  const db = monk(dbURL);
  try {
    const { total, refused, list } = await checkStoredProjects(db);
    for (const project of list) {
      console.log(`${project.shortname} (owner ${project.owner}):\n  - ${project.problems.map(formatProblem).join('\n  - ')}`);
    }
    console.log(`\n${total} projects, ${refused} cannot be saved again unchanged.`);
  } finally {
    await db.close();
  }
};

if (require.main === module) {
  const dbArg = process.argv.indexOf('--db');
  if (dbArg < 0 || !process.argv[dbArg + 1]) {
    console.error('Usage: node scripts/check-projects.js --db <host:port/database>');
    process.exitCode = 2;
  } else {
    main(process.argv[dbArg + 1]).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
