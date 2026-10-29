/**
 * The editor save (POST /api, saveFromGUI) applies only its own changes, region
 * by region, by `uid`, to what is on the server now (maintainer, 2026-10-29):
 * - a region sent that is not on the server is inserted, under the saver's name;
 * - a region sent with another path or name than its current document replaces
 *   it: the old document becomes a backup, the new one is stored under the
 *   saver's name (the last save wins for that region);
 * - a region sent unchanged is left exactly as it is (document, _id, user);
 * - a region in RegionsToRemove (and not sent) has its current document marked
 *   as a backup;
 * - a region on the server that the save neither sends nor removes is left as
 *   it is: another user saved it after this client loaded the slice.
 * Nothing is deleted: replaced and removed regions become backups.
 *
 * The API upload (POST /api/upload) still uses updateAnnotation in index.js.
 */
const monk = require('monk');

const current = { backup: { $exists: false } };

// A JSON string with the keys of every object sorted: two values that are equal
// once parsed give the same string, whatever their key order. A stored path may
// be the parsed array (what saves store) or a JSON string.
const canonical = (value) => {
  if (typeof value === 'string') {
    try {
      return canonical(JSON.parse(value));
    } catch (err) {
      return JSON.stringify(value);
    }
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const sameRegion = (stored, sent) => Boolean(stored)
  && stored.name === sent.name
  && canonical(stored.path) === canonical(sent.path);

// Back up the current documents of one region. With `olderThan`, only those
// inserted before it: the version just inserted stays current, and of two
// overlapping saves of the same region the later insert wins.
const backUpRegion = (db, { fileID, project }, uid, olderThan) => db.updateAnnotations({
  query: {
    fileID,
    project,
    'annotation.uid': uid,
    ...(olderThan ? { _id: { $lt: olderThan } } : {}),
    ...current
  },
  update: { $set: { backup: true } },
  options: { multi: true }
});

// A document stored without `annotation.uid` (older data) is keyed by its
// _id: the viewer gives such a region String(_id) as uid when it loads it.
const hasUid = (doc) => Boolean(doc.annotation)
  && typeof doc.annotation.uid !== 'undefined' && doc.annotation.uid !== null && doc.annotation.uid !== '';
const keyOf = (doc) => {
  if (hasUid(doc)) {
    return doc.annotation.uid;
  }

  if (typeof doc._id !== 'undefined') {
    return String(doc._id);
  }
};

// Back up the documents without uid among `docs`, by _id (backUpRegion matches
// on annotation.uid, which they don't have).
const backUpByIds = (db, docs) => {
  const ids = docs.filter((d) => !hasUid(d)).map((d) => d._id);

  if (ids.length === 0) {
    return Promise.resolve();
  }

  return db.updateAnnotations({
    query: { _id: { $in: ids }, ...current },
    update: { $set: { backup: true } },
    options: { multi: true }
  });
};

/**
 * Apply an editor save.
 * @param {object} req The request (req.app.db is the database)
 * @param {object} save {fileID, user, project, Hash, annotationString}
 * @returns {Promise<object>} {inserted, unchanged, removed}: uids
 */
// eslint-disable-next-line max-statements
const saveEditorChanges = async (req, { fileID, user, project, Hash, annotationString }) => {
  const { db } = req.app;
  const slice = { fileID, project };
  const annotation = JSON.parse(annotationString);
  const regions = Array.isArray(annotation.Regions) ? annotation.Regions : [];
  const uidsToRemove = Array.isArray(annotation.RegionsToRemove) ? annotation.RegionsToRemove : [];

  // the current documents of the slice, by region uid (every user's)
  const stored = new Map();
  for (const doc of await db.findAnnotations(slice)) {
    const uid = keyOf(doc);
    if (typeof uid !== 'undefined') {
      stored.set(uid, (stored.get(uid) || []).concat(doc));
    }
  }

  const result = { inserted: [], unchanged: [], removed: [] };
  const sent = new Set();
  for (const region of regions) {
    // a region without uid can't be matched: ignored. The viewer gives a uid to every region.
    if (region && typeof region.uid !== 'undefined' && !sent.has(region.uid)) {
      sent.add(region.uid);
      const docs = stored.get(region.uid) || [];
      if (docs.length === 1 && sameRegion(docs[0].annotation, region)) {
        result.unchanged.push(region.uid);
      } else {
        const _id = monk.id();
        // eslint-disable-next-line no-await-in-loop
        await db.insertAnnotations([{ _id, fileID, user, project, Hash, annotation: region }]);
        // eslint-disable-next-line no-await-in-loop
        await backUpRegion(db, slice, region.uid, _id);
        // eslint-disable-next-line no-await-in-loop
        await backUpByIds(db, docs);
        result.inserted.push(region.uid);
      }
    }
  }

  // RegionsToRemove keeps every uid removed since the slice was loaded: an uid
  // already backed up matches nothing; one that is also sent stays (sent wins).
  for (const uid of new Set(uidsToRemove)) {
    if (!sent.has(uid) && stored.has(uid)) {
      // eslint-disable-next-line no-await-in-loop
      await backUpRegion(db, slice, uid);
      // eslint-disable-next-line no-await-in-loop
      await backUpByIds(db, stored.get(uid));
      result.removed.push(uid);
    }
  }

  return result;
};

module.exports = { saveEditorChanges, canonical };
