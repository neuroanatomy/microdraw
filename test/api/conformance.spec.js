/**
 * NeuroWebLab's shared project-management suite, slice 1 (access matrix),
 * against the server test/api/runner.js started (neuroweblab/conformance/README.md).
 */
const { accessMatrix } = require('neuroweblab/conformance');
const U = require('../mocha.test.util');

const db = () => U.getNativeDB();

accessMatrix({
  baseURL: () => U.serverURL,
  layer: { type: 'vectorial', values: 'Set I' },
  // a project without an `anyone` row can't be saved over HTTP (validation)
  insertProject: (doc) => db().collection('projects')
    .insertOne(doc),
  // every version, and the delete logs
  removeProject: async (owner, shortname) => {
    await db().collection('projects')
      .deleteMany({ shortname });
    await db().collection('log')
      .deleteMany({ 'value.shortname': shortname });
  },
  removeUser: async (username) => {
    await db().collection('users')
      .deleteMany({ username });
    await db().collection('log')
      .deleteMany({ username });
  },
  routes: { files: null },
  expectedDifferences: {
    'route:files': 'ledger "Paged project files route": /project/json/:p/files missing in microdraw (stage 3.1)',
    '1.5/status': 'inventory 1.5: no view right answers 403, BrainBox 401 (schema §4 "No view right")',
    '1.6/status': 'inventory 1.6: unknown project JSON answers 404 {error}, BrainBox 200 empty (schema §4)',
    '2.1/status': 'inventory 2.1: save logged out answers 401, BrainBox 403 (not in the ledger)'
  }
});
