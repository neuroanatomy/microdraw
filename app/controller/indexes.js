/**
 * Indexes the app needs, created once at startup (app.js, after nwl.init).
 * createIndex is idempotent: an index that exists with the same keys and name
 * is left as it is. Any error (e.g. the same keys under another name) is
 * logged and does not stop the app: the queries still work, only slower.
 */
const log = require('../log');

// The user page's "Last modified": the newest annotation of each listed
// project (user/lastModified.js newestAnnotations), $match on project then $max
// of _id. Without it, every user-page load scans the whole collection.
const ANNOTATIONS_PROJECT_INDEX = 'project_1__id_-1';

// Values of text layers (textAnnotations.js): reads and writes go by
// (project, source, layer), readers take the newest current document by _id.
const TEXT_ANNOTATIONS_INDEX = 'project_1_source_1_layer_1__id_-1';

// Projects by shortname (project/currentProject.js): every project read. Not
// unique: a project's old versions keep its shortname (T002 2.1), as in
// BrainBox, whose `project` collection has the same index and name.
const PROJECTS_SHORTNAME_INDEX = 'shortname_1';

// One document per dataset (T002 3.3, datasets.js): unique, so that two
// simultaneous saves adding the same dataset create one document
const DATASETS_SOURCE_INDEX = 'source_1';

// The user page's Annotations tab (T002 3.4, user/userTabs.js
// userAnnotationsPipeline): one aggregation that starts with $match on the
// user's current annotations. Without it, every load of the tab scans the
// whole collection.
const ANNOTATIONS_USER_INDEX = 'user_1_project_1';

// The embed's WebSocket tickets (T002 3.7, embed/EmbedAccessService.js): looked
// up by token; MongoDB removes them once expired (findWsTicket refuses them
// before that)
const EMBED_TICKET_TOKEN_INDEX = 'token_1';
const EMBED_TICKET_EXPIRY_INDEX = 'expiryDate_1';

// [collection, keys, name, options]
const INDEXES = [
  ['annotations', { project: 1, _id: -1 }, ANNOTATIONS_PROJECT_INDEX],
  ['annotations', { user: 1, project: 1 }, ANNOTATIONS_USER_INDEX],
  ['textAnnotations', { project: 1, source: 1, layer: 1, _id: -1 }, TEXT_ANNOTATIONS_INDEX],
  ['projects', { shortname: 1 }, PROJECTS_SHORTNAME_INDEX],
  ['datasets', { source: 1 }, DATASETS_SOURCE_INDEX, { unique: true }],
  ['embedWsTicket', { token: 1 }, EMBED_TICKET_TOKEN_INDEX],
  ['embedWsTicket', { expiryDate: 1 }, EMBED_TICKET_EXPIRY_INDEX, { expireAfterSeconds: 0 }]
];

/**
 * Create the app's indexes if they are missing
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @returns {Promise<void>} Resolves once done; never rejects
 */
const ensureIndexes = async (db) => {
  for (const [collection, keys, name, options = {}] of INDEXES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.collection(collection).createIndex(keys, { ...options, name });
    } catch (err) {
      log.warn({ err, index: name }, `cannot create the ${collection} index`);
    }
  }
};

module.exports = {
  ensureIndexes, ANNOTATIONS_PROJECT_INDEX, ANNOTATIONS_USER_INDEX, TEXT_ANNOTATIONS_INDEX, PROJECTS_SHORTNAME_INDEX, DATASETS_SOURCE_INDEX
};
