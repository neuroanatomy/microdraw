/**
 * Values of text layers (text layers step 2, 2026-11-09): one value per
 * (project, file source, layer), in the `textAnnotations` collection, as
 * documents {project, source, layer, value, user, modified}. A write marks the
 * current document(s) of its key `backup: true` and then inserts the new one,
 * as the annotation saves do, so history is kept. Two simultaneous writes may
 * leave two current documents: readers take the newest by _id.
 *
 * Only named `text` layers hold values (an unnamed one has no column on the
 * project page), and only for sources in the project's files list.
 */
const TEXT_ANNOTATIONS = 'textAnnotations';
const MAX_TEXT_LENGTH = 10000;

const current = { backup: { $exists: false } };

const listOf = (project, type) => ((project && project[type] && Array.isArray(project[type].list)) ? project[type].list : []);

/**
 * Names of the project's named text layers
 * @param {object} project A project document
 * @returns {string[]} The names, as stored
 */
const namedTextLayers = (project) => listOf(project, 'annotations')
  .filter((a) => a && a.type === 'text' && typeof a.name === 'string' && a.name.trim() !== '')
  .map((a) => a.name);

/**
 * Sources of the project's files
 * @param {object} project A project document
 * @returns {string[]} The sources (non-empty strings)
 */
const projectSources = (project) => listOf(project, 'files')
  .filter((f) => f && typeof f.source === 'string' && f.source !== '')
  .map((f) => f.source);

/**
 * Why a write of `body` to `project` is refused: an error message, or
 * undefined when the layer, source and value are valid
 * @param {object} project The stored project
 * @param {object} body { source, layer, value }
 * @returns {string|undefined} The error
 */
const textWriteError = (project, { source, layer, value }) => {
  if (typeof layer !== 'string' || !namedTextLayers(project).includes(layer)) {
    return `Layer ${JSON.stringify(layer)} is not a named text layer of project ${project.shortname}`;
  }
  if (typeof source !== 'string' || !projectSources(project).includes(source)) {
    return `Source ${JSON.stringify(source)} is not a file of project ${project.shortname}`;
  }
  if (typeof value !== 'string') {
    return 'The value must be a string';
  }
  if (value.length > MAX_TEXT_LENGTH) {
    return `The value is longer than ${MAX_TEXT_LENGTH} characters`;
  }
};

/**
 * Store a value: the current document(s) of the key become backups, then the
 * new one is inserted. '' is stored as a value (it clears the cell).
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {object} params { project: shortname, source, layer, value, user }
 * @returns {Promise<object>} { value, user, modified }
 */
const storeTextValue = async (db, { project, source, layer, value, user }) => {
  const collection = db.collection(TEXT_ANNOTATIONS);
  await collection.updateMany({ project, source, layer, ...current }, { $set: { backup: true } });
  const doc = { project, source, layer, value, user, modified: new Date() };
  await collection.insertOne(doc);

  return { value: doc.value, user: doc.user, modified: doc.modified };
};

// { <source>: { <layer>: {value, user, modified} } } from documents sorted
// newest first: the first one of each key
const newestPerKey = (docs, values) => {
  for (const { source, layer, value, user, modified } of docs) {
    values[source] = values[source] || Object.create(null);
    if (!(layer in values[source])) {
      values[source][layer] = { value, user, modified };
    }
  }

  return values;
};

/**
 * Current values of a project's named text layers for its listed files, the
 * newest current document of each key
 * @param {object} db Native MongoDB Db (app.db.nativeMongoDB())
 * @param {object} project The project as the visitor may see it (visibleProjectParts)
 * @returns {Promise<object>} { <source>: { <layer>: { value, user, modified } } }
 */
const currentTextValues = async (db, project) => {
  const layers = namedTextLayers(project);
  const sources = projectSources(project);
  // keys come from user data (sources, layer names): no prototype
  const values = Object.create(null);
  if (layers.length === 0 || sources.length === 0) {
    return values;
  }
  const docs = await db.collection(TEXT_ANNOTATIONS).find(
    { project: project.shortname, source: { $in: sources }, layer: { $in: layers }, ...current },
    { sort: { _id: -1 }, projection: { _id: 0, source: 1, layer: 1, value: 1, user: 1, modified: 1 } }
  )
    .toArray();

  return newestPerKey(docs, values);
};

module.exports = {
  TEXT_ANNOTATIONS,
  MAX_TEXT_LENGTH,
  namedTextLayers,
  projectSources,
  textWriteError,
  storeTextValue,
  currentTextValues
};
