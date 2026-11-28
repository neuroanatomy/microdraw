/* global db */
// The distinct sources the current versions of microdraw's projects list
// (S1d, decisions D42), for scripts/check-dataset-forms.js. Read only: one
// aggregation on `projects`, nothing written.
//
// It prints one source per line, then a tab and the number of projects that
// list it, and nothing else: no project, owner or user names.
//
// Run it with mongosh, on the server, on the database the app uses (the path
// of MONGODB, `microdraw` by default, app/app.js):
//   mongosh --quiet microdraw --file scripts/list-dataset-sources.mongosh.js > sources.txt
//
// What a project lists (app/controller/datasets.js fileRows, NeuroWebLab's
// projectFiles.js): its current version has no `backup` field (currentProject.js),
// and `files.list` holds every file in one array, even when the settings page
// loads it in pages (M10); an entry is a plain string (older projects) or
// { source, name }.

const DATASET_SOURCES = [
  { $match: { backup: { $exists: false } } },
  { $project: { list: { $cond: [{ $isArray: '$files.list' }, '$files.list', []] } } },
  { $unwind: '$list' },
  { $project: { source: { $cond: [{ $eq: [{ $type: '$list' }, 'string'] }, '$list', '$list.source'] } } },
  { $match: { source: { $type: 'string', $ne: '' } } },
  // once per project, even when a project lists a source twice
  { $group: { _id: { source: '$source', project: '$_id' } } },
  { $group: { _id: '$_id.source', projects: { $sum: 1 } } },
  { $sort: { _id: 1 } }
];

db.getCollection('projects').aggregate(DATASET_SOURCES, { allowDiskUse: true })
  .forEach((row) => print(`${row._id}\t${row.projects}`));
