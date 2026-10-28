/**
 * The "Last modified" date of a project on the user page: the later of its
 * last save (`modified`, set by POST /project/json/:projectName) and its
 * newest annotation.
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
 * The later of a project's last save (`modified`, an ISO string) and its
 * newest annotation, as an ISO string, or null when neither is known
 * @param {string} saved The project's `modified`
 * @param {Date} annotated The date of its newest annotation
 * @returns {string|null} The date
 */
const lastModified = (saved, annotated) => {
  const times = [Date.parse(saved), annotated ? annotated.getTime() : NaN].filter(Number.isFinite);

  return times.length > 0 ? new Date(Math.max(...times)).toJSON() : null;
};

module.exports = { lastModified, newestAnnotations, newestAnnotationsPipeline };
