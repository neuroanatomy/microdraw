/**
 * NeuroWebLab's shared project-management suite, slices 1 (access matrix),
 * 2 (create, save, delete, validation, versions) and 3 (listings and search), against the server
 * test/api/runner.js started (neuroweblab/conformance/README.md).
 */
const { accessMatrix, projectLifecycle, projectListings } = require('neuroweblab/conformance');
const U = require('../mocha.test.util');

const db = () => U.getNativeDB();

const adapter = {
  baseURL: () => U.serverURL,
  layer: { type: 'vectorial', values: 'Set I' },
  // a project without an `anyone` row can't be saved over HTTP (validation)
  insertProject: (doc) => db().collection('projects')
    .insertOne(doc),
  // every version, the delete logs, and the annotations of slice 2
  removeProject: async (owner, shortname) => {
    await db().collection('projects')
      .deleteMany({ shortname });
    await db().collection('log')
      .deleteMany({ 'value.shortname': shortname });
    await db().collection('annotations')
      .deleteMany({ project: shortname });
  },
  removeUser: async (username) => {
    await db().collection('users')
      .deleteMany({ username });
    await db().collection('log')
      .deleteMany({ username });
  },
  versions: (shortname) => db().collection('projects')
    .find({ shortname }, { sort: { _id: 1 } })
    .toArray(),
  // a region on slice 0 of the file; read by GET /api
  annotations: {
    add: (owner, shortname, file) => db().collection('annotations')
      .insertOne({
        fileID: `${file.source}&slice=0`,
        user: owner.username,
        project: shortname,
        Hash: 'conformance',
        annotation: { name: 'conformance', uid: `${shortname}uid`, path: ['Path', { segments: [[0, 0], [1, 1], [2, 0]], closed: true }] }
      }),
    readable: async (user, shortname, file) => {
      const res = await user.client.get(`/api?source=${encodeURIComponent(file.source)}&slice=0&project=${encodeURIComponent(shortname)}`);
      const body = res.status === 200 ? JSON.parse(res.text) : [];

      return Array.isArray(body) && body.length > 0;
    }
  },
  // slice 3 (3.7): a name and an email for a user
  setUserFields: (username, fields) => db().collection('users')
    .updateOne({ username }, { $set: fields }),
  routes: { files: null, searchUsers: '/search/json/users?q=:q' },
  expectedDifferences: {
    'route:files': 'ledger "Paged project files route": /project/json/:p/files missing in microdraw (stage 3.1)',
    '1.5/status': 'inventory 1.5: no view right answers 403, BrainBox 401 (schema §4 "No view right")',
    '1.6/status': 'inventory 1.6: unknown project JSON answers 404 {error}, BrainBox 200 empty (schema §4)'
  }
};

accessMatrix(adapter);
projectLifecycle(adapter);
projectListings(adapter);
