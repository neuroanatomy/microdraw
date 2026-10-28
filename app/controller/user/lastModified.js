/**
 * The "Last modified" date of a project on the user page: the later of its
 * last save (`modified`, set by POST /project/json/:projectName) and its
 * newest annotation; its creation date when it has neither.
 */

// The aggregation of newestAnnotations, which the index {project: 1, _id: -1}
// serves (created at startup, controller/indexes.js)
const newestAnnotationsPipeline = (shortnames) => [
  { $match: { project: { $in: shortnames } } },
  { $group: { _id: '$project', last: { $max: '$_id' } } }
];

/**
 * The time of the newest annotation saved in each of `shortnames`: one
 * aggregation, the time read from the _id of the annotation documents
 * (backups included: a save marks the previous version as backup, and the
 * documents keep their _id).
 * @param {object} db Monk database
 * @param {Array<string>} shortnames Project shortnames
 * @returns {Promise<Map<string, Date>>} shortname → date
 */
const newestAnnotations = async (db, shortnames) => {
  if (shortnames.length === 0) {
    return new Map();
  }
  const rows = await db.get('annotations').aggregate(newestAnnotationsPipeline(shortnames));

  return new Map(rows.map((row) => [row._id, row.last.getTimestamp()]));
};

/**
 * The latest of a project's last save (`modified`, an ISO string), its newest
 * annotation and its creation (`created`, an ISO string), as an ISO string,
 * or null when none is known. `created` fills the gap of projects never saved
 * since saves set `modified` and without annotations; it is never later than
 * the others, the maximum is taken anyway.
 * @param {string} saved The project's `modified`
 * @param {Date} annotated The date of its newest annotation
 * @param {string} created The project's `created`
 * @returns {string|null} The date
 */
const lastModified = (saved, annotated, created) => {
  const times = [Date.parse(saved), annotated ? annotated.getTime() : NaN, Date.parse(created)].filter(Number.isFinite);

  return times.length > 0 ? new Date(Math.max(...times)).toJSON() : null;
};

module.exports = { lastModified, newestAnnotations, newestAnnotationsPipeline };
