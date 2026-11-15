/**
 * Admin tools for one dataset (T002 3.6, part B), as BrainBox's "one MRI"
 * (getMRI, removeMRIAnnotations), plus the change of a dataset document's
 * owner and name (the backfill of 3.3 gave some surprising ones).
 *
 * A dataset is a source URL (datasets.js). Its annotations are the documents
 * of `annotations` whose fileID is `<source>&slice=<slice>`, in any project.
 * Whether someone has it open is asked of the live-update rooms
 * (liveRooms.js viewersOfSource) by the controller.
 *
 * Nothing is deleted: removing annotations marks them `backup: true`, as a
 * save does, and is logged with their ids; restoreAnnotations undoes it. The
 * change of a document is logged with the old values.
 */
const _ = require('lodash');
const logger = require('../../log');
const { escapeRegex, toId } = require('neuroweblab');
const { DATASETS, defaultName, fileRows, isDatasetSource } = require('../datasets');
const { plainText } = require('../project/project.validation');
const { CURRENT: current } = require('../project/currentProject');

const MAX_NAME_LENGTH = 200;

// The current annotations of a dataset, in a project and by a user if given
const annotationsQuery = ({ source, project, user }) => {
  const query = { ...current, fileID: new RegExp(`^${escapeRegex(source)}&slice=`) };
  if (typeof project === 'string') {
    query.project = project;
  }
  if (typeof user === 'string') {
    query.user = user;
  }

  return query;
};

const log = async (db, key, value) => {
  const { ids, ...rest } = value;
  logger.info({ event: key, ...(ids ? { ...rest, documents: ids.length } : rest) }, `admin: ${key}`);
  const entry = { key, value, date: (new Date()).toJSON() };
  await db.collection('log').insertOne(entry); // sets entry._id

  return entry;
};

/**
 * A dataset: its document, the current projects that list it (with their
 * row's name), and its current annotations per project and user. Read-only.
 * @param {object} db Native MongoDB Db
 * @param {string} source The dataset's URL, as in `files.list[].source`
 * @returns {Promise<object>} { source, document: { name, owner, included } |
 *   null, projects: [{ shortname, name, owner, row }], annotations: [{
 *   project, user, regions, slices }] }
 */
const findDataset = async (db, source) => {
  const doc = await db.collection(DATASETS).findOne({ source }, { projection: { _id: 0, name: 1, owner: 1, included: 1 } });
  const listing = await db.collection('projects').find(
    { ...current, $or: [{ 'files.list.source': source }, { 'files.list': source }] },
    { projection: { _id: 0, shortname: 1, name: 1, owner: 1, 'files.list': 1 }, sort: { shortname: 1 } }
  )
    .toArray();
  const projects = listing.map((p) => ({
    shortname: p.shortname,
    name: typeof p.name === 'string' ? p.name : '',
    owner: p.owner,
    row: (fileRows(p).find((r) => r.source === source) || { name: '' }).name
  }));
  const counted = await db.collection('annotations').aggregate([
    { $match: annotationsQuery({ source }) },
    {
      $group: {
        _id: { project: { $ifNull: ['$project', null] }, user: { $ifNull: ['$user', null] } },
        regions: { $sum: 1 },
        fileIDs: { $addToSet: '$fileID' }
      }
    },
    { $sort: { '_id.project': 1, '_id.user': 1 } }
  ], { allowDiskUse: true })
    .toArray();
  const annotations = counted.map((c) => ({ project: c._id.project, user: c._id.user, regions: c.regions, slices: c.fileIDs.length }));

  return { source, document: doc || null, projects, annotations };
};

/**
 * Check a change of a dataset document
 * @param {object} body { source, owner?, name? }
 * @returns {object} { source, owner, name } (owner and name undefined when
 *   not changed) or { error }
 */
// eslint-disable-next-line max-statements
const checkUpdate = (body) => {
  const { source } = body;
  if (!isDatasetSource(source)) {
    return { error: 'Provide the source: the http(s) URL of the dataset' };
  }
  let name, owner;
  if (typeof body.owner !== 'undefined') {
    if (typeof body.owner !== 'string' || body.owner.trim() === '') {
      return { error: 'The owner must be a username' };
    }
    owner = body.owner.trim();
  }
  if (typeof body.name !== 'undefined') {
    name = typeof body.name === 'string' ? plainText(body.name).trim() : '';
    if (name === '' || name.length > MAX_NAME_LENGTH) {
      return { error: `The name must be a text of 1 to ${MAX_NAME_LENGTH} characters` };
    }
  }
  if (typeof owner === 'undefined' && typeof name === 'undefined') {
    return { error: 'Provide the owner, the name, or both' };
  }

  return { source, owner, name };
};

/**
 * Set the owner and/or the name of a dataset's document; create it if there
 * is none (it then needs an owner; the name defaults as in datasets.js).
 * Logged with the old values.
 * @param {object} db Native MongoDB Db
 * @param {object} params { source, owner, name, username } (owner and name
 *   undefined when not changed)
 * @returns {Promise<object>} { document, created, log } or { status, error }
 */
// eslint-disable-next-line max-statements
const updateDataset = async (db, { source, owner, name, username }) => {
  if (typeof owner === 'string' && !await db.collection('users').findOne({ username: owner }, { projection: { _id: 1 } })) {
    return { status: 400, error: `User ${owner} does not exist` };
  }
  const datasets = db.collection(DATASETS);
  const before = await datasets.findOne({ source });
  if (!before && typeof owner !== 'string') {
    return { status: 400, error: 'This dataset has no document yet: give its owner' };
  }
  const changes = _.omitBy({ owner, name }, _.isUndefined);
  const onInsert = _.omit({ name: defaultName(source), included: (new Date()).toJSON() }, Object.keys(changes));
  await datasets.updateOne({ source }, { $set: changes, $setOnInsert: onInsert }, { upsert: true });
  const after = await datasets.findOne({ source }, { projection: { _id: 0, name: 1, owner: 1, included: 1 } });
  const entry = await log(db, 'adminUpdateDataset', {
    username,
    source,
    created: !before,
    before: before ? _.pick(before, ['name', 'owner']) : null,
    after: _.pick(after, ['name', 'owner'])
  });

  return { document: after, created: !before, log: String(entry._id) };
};

/**
 * Mark backup the current annotations of a dataset in a project (by a user,
 * if given), as a save does. The caller refuses it while the dataset is open.
 * @param {object} db Native MongoDB Db
 * @param {object} params { source, project, user (or undefined for all), username }
 * @returns {Promise<object>} { removed, log } or { status, error }
 */
const removeAnnotations = async (db, { source, project, user, username }) => {
  const docs = await db.collection('annotations').find(annotationsQuery({ source, project, user }), { projection: { _id: 1 } })
    .toArray();
  if (docs.length === 0) {
    return { status: 404, error: 'No current annotations of this dataset in that project, by that user' };
  }
  const ids = docs.map((d) => d._id);
  await db.collection('annotations').updateMany({ _id: { $in: ids }, ...current }, { $set: { backup: true } });
  const entry = await log(db, 'adminRemoveDatasetAnnotations', {
    username, source, project, user: typeof user === 'string' ? user : null, ids: ids.map(String)
  });

  return { removed: ids.length, log: String(entry._id) };
};

/**
 * Undo removeAnnotations: the documents it marked become current again.
 * Refused if the dataset has current annotations again in that project (by
 * that user), saved since. The caller refuses it while the dataset is open.
 * @param {object} db Native MongoDB Db
 * @param {object} params { logId, username }
 * @returns {Promise<object>} { restored, source } or { status, error }
 */
// eslint-disable-next-line max-statements
const restoreAnnotations = async (db, { logId, username }) => {
  const id = toId(logId);
  const entry = id && await db.collection('log').findOne({ _id: id, key: 'adminRemoveDatasetAnnotations' });
  if (!entry) {
    return { status: 404, error: 'No removal of dataset annotations with that log id' };
  }
  const { source, project, user, ids } = entry.value;
  const now = await db.collection('annotations').countDocuments(annotationsQuery({ source, project, user }));
  if (now > 0) {
    return { status: 409, error: 'This dataset has current annotations again in that project (restored already, or saved since)' };
  }
  const result = await db.collection('annotations').updateMany(
    { _id: { $in: ids.map(toId).filter(Boolean) }, backup: true },
    { $unset: { backup: '' } }
  );
  await log(db, 'adminRestoreDatasetAnnotations', { username, removal: String(entry._id), source, project, user, restored: result.modifiedCount });

  return { restored: result.modifiedCount, source };
};

/**
 * The source of a removal logged by removeAnnotations (to check whether the
 * dataset is open before restoring)
 * @param {object} db Native MongoDB Db
 * @param {string} logId The log id
 * @returns {Promise<string|null>} The source, or null
 */
const removalSource = async (db, logId) => {
  const id = toId(logId);
  const entry = id && await db.collection('log').findOne({ _id: id, key: 'adminRemoveDatasetAnnotations' }, { projection: { 'value.source': 1 } });

  return entry ? entry.value.source : null;
};

module.exports = {
  checkUpdate,
  findDataset,
  updateDataset,
  removeAnnotations,
  restoreAnnotations,
  removalSource
};
