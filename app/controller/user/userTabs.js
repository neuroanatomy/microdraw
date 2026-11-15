/**
 * The user page's Datasets and Annotations tabs (T002 3.4), as BrainBox's
 * getUserFilesSlice and getUserAtlasSlice (controller/dataSlices/dataSlices.js):
 * the rows are filtered by what the visitor may see, then paged, so that a
 * page is never short because of hidden rows.
 *
 * - Datasets: the documents of `datasets` (T002 3.3) that the user owns. As
 *   BrainBox (hasAccesstoFileIfAllowedBySomeProjects), a dataset is listed only
 *   if one of the user's current projects (owner or collaborator) lists it and
 *   gives the visitor files view; one in none of them is not listed.
 * - Annotations: one row per (dataset, project) in which the user has current
 *   annotations, listed only if the visitor may view that project's files and
 *   annotations (the project page's rule, M3c).
 */
const _ = require('lodash');
const { AccessControlService } = require('neuroweblab');
const { CURRENT, findUserProjects } = require('../project/currentProject');
const { DATASETS, defaultName, fileRows, isDatasetSource } = require('../datasets');

// Rows per page: `length` is capped at it, and is it when missing
const MAX_LENGTH = 100;

/**
 * The page asked for by `start` and `length` (query parameters): 0 and
 * MAX_LENGTH when missing or not non-negative integers, `length` at most
 * MAX_LENGTH
 * @param {object} query The request's query
 * @returns {object} {start, length}
 */
const pageOf = (query) => {
  const int = (value, fallback) => {
    const n = Number(value);

    return (typeof value === 'string' && value !== '' && Number.isInteger(n) && n >= 0) ? n : fallback;
  };

  return { start: int(query.start, 0), length: Math.min(int(query.length, MAX_LENGTH), MAX_LENGTH) };
};

/**
 * The sources a project lists (`files.list`, rows or plain strings)
 * @param {object} project A project document
 * @returns {Set<string>} The sources
 */
const sourcesOf = (project) => new Set(fileRows(project).map((row) => row.source));

/**
 * The Datasets tab: the datasets `username` owns that the visitor may see,
 * newest `included` first
 * @param {object} db Native MongoDB Db
 * @param {string} username The user whose page it is
 * @param {string} visitor The visitor's username, or 'anyone'
 * @returns {Promise<Array<object>>} [{url, name, included, projects}], every
 *   row, not paged; `projects`: the shortnames of the projects that list the
 *   dataset and give the visitor files view
 */
const userDatasets = async (db, username, visitor) => {
  const [datasets, projects] = await Promise.all([
    db.collection(DATASETS).find({ owner: username }, { projection: { _id: 0, source: 1, name: 1, included: 1 } })
      .sort({ included: -1, source: 1 })
      .toArray(),
    findUserProjects(db, username)
  ]);
  const viewable = projects
    .filter((project) => AccessControlService.canViewFiles(project, visitor))
    .map((project) => ({ shortname: project.shortname, sources: sourcesOf(project) }));

  return datasets
    .map((dataset) => ({
      url: dataset.source,
      name: dataset.name,
      included: dataset.included,
      projects: _.uniq(viewable.filter((p) => p.sources.has(dataset.source)).map((p) => p.shortname))
    }))
    .filter((row) => row.projects.length > 0);
};

/**
 * The aggregation of the Annotations tab: the user's current annotations, one
 * result per (project, source), with the number of distinct slices (fileIDs)
 * and the newest _id. The source is the part of `fileID` before its last
 * `&slice=` (buildFileID, api/index.js). The index {user: 1, project: 1}
 * (indexes.js) serves the $match.
 * @param {string} username The user
 * @returns {Array<object>} The pipeline
 */
const userAnnotationsPipeline = (username) => [
  { $match: { user: username, backup: { $exists: false } } },
  { $group: { _id: { project: '$project', fileID: '$fileID' }, last: { $max: '$_id' } } },
  {
    $project: {
      _id: 0,
      project: '$_id.project',
      last: 1,
      source: {
        $let: {
          vars: { m: { $regexFind: { input: { $toString: '$_id.fileID' }, regex: '^([\\s\\S]*)&slice=' } } },
          in: { $cond: [{ $eq: ['$$m', null] }, { $toString: '$_id.fileID' }, { $arrayElemAt: ['$$m.captures', 0] }] }
        }
      }
    }
  },
  { $group: { _id: { project: '$project', source: '$source' }, slices: { $sum: 1 }, last: { $max: '$last' } } }
];

/**
 * The name of a row without a dataset document or a named project row: the
 * last segment of its URL (defaultName), else of the string
 * @param {string} source The source
 * @returns {string} The name
 */
const lastSegment = (source) => {
  if (isDatasetSource(source)) {
    return defaultName(source);
  }
  const segments = String(source).split('/')
    .filter((s) => s !== '');

  return segments.length > 0 ? segments[segments.length - 1] : String(source);
};

/**
 * The current versions of projects, by shortname; of several current
 * versions of one, the newest (as findCurrentProject)
 * @param {object} db Native MongoDB Db
 * @param {Array} shortnames Shortnames (others than non-empty strings ignored)
 * @returns {Promise<Map<string, object>>} shortname → project
 */
const currentProjects = async (db, shortnames) => {
  const names = _.uniq(shortnames.filter((p) => typeof p === 'string' && p !== ''));
  const projectOf = new Map();
  if (names.length === 0) {
    return projectOf;
  }
  const projects = await db.collection('projects')
    .find({ shortname: { $in: names }, ...CURRENT }, { sort: { _id: -1 } })
    .toArray();
  for (const project of projects) {
    if (!projectOf.has(project.shortname)) {
      projectOf.set(project.shortname, project);
    }
  }

  return projectOf;
};

/**
 * The names of the dataset documents of `sources`
 * @param {object} db Native MongoDB Db
 * @param {Array<string>} sources The sources
 * @returns {Promise<Map<string, string>>} source → name
 */
const datasetNames = async (db, sources) => {
  if (sources.length === 0) {
    return new Map();
  }
  const datasets = await db.collection(DATASETS)
    .find({ source: { $in: _.uniq(sources) } }, { projection: { _id: 0, source: 1, name: 1 } })
    .toArray();

  return new Map(datasets.map((d) => [d.source, d.name]));
};

/**
 * The Annotations tab: one row per (dataset, project) in which `username`
 * has current annotations and whose files and annotations the visitor may
 * view, newest first. `modified` is the time of the newest of those
 * annotations, read from its _id: annotation documents have no date of their
 * own.
 * @param {object} db Native MongoDB Db
 * @param {string} username The user whose page it is
 * @param {string} visitor The visitor's username, or 'anyone'
 * @returns {Promise<Array<object>>} [{url, name, project, slices, modified}],
 *   every row, not paged
 */
const userAnnotations = async (db, username, visitor) => {
  const groups = await db.collection('annotations').aggregate(userAnnotationsPipeline(username))
    .toArray();
  const projectOf = await currentProjects(db, groups.map((g) => g._id.project));
  const shown = groups.filter((g) => {
    const project = projectOf.get(g._id.project);

    return Boolean(project) && AccessControlService.canViewFiles(project, visitor) &&
      AccessControlService.canViewAnnotations(project, visitor);
  });
  const datasetName = await datasetNames(db, shown.map((g) => g._id.source));
  const rowName = (project, source) => {
    const row = fileRows(projectOf.get(project)).find((r) => r.source === source && r.name.trim() !== '');

    return row ? row.name : '';
  };

  return shown
    .map((g) => {
      const { project, source } = g._id;

      return {
        url: source,
        name: datasetName.get(source) || rowName(project, source) || lastSegment(source),
        project,
        slices: g.slices,
        // an _id that is not an ObjectId has no time: no date
        modified: (g.last && typeof g.last.getTimestamp === 'function') ? g.last.getTimestamp().toJSON() : null
      };
    })
    .sort((a, b) => (b.modified || '').localeCompare(a.modified || '') || a.url.localeCompare(b.url) || a.project.localeCompare(b.project));
};

module.exports = { MAX_LENGTH, pageOf, userAnnotations, userAnnotationsPipeline, userDatasets };
