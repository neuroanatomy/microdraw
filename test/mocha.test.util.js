const chai = require('chai');
const chaiHttp = require('chai-http');
const microdrawApp = require('../app/app');

chai.use(chaiHttp);

let appServer, db, wsServer;
let serverPort = 3000;

// permissions.spec.js cookies against 127.0.0.1, the browser specs localhost.
const serverOrigin = () => `http://127.0.0.1:${serverPort}`;
const url = (pathname = '') => `http://localhost:${serverPort}${pathname}`;

const initResources = async () => {
  let app, port;
  // Port 0 => OS picks a free one. Pin with E2E_PORT / E2E_WS_PORT if needed.
  process.env.PORT = process.env.E2E_PORT || '0';
  process.env.WS_PORT = process.env.E2E_WS_PORT || '0';
  // Pin the config so results ignore the developer's gitignored cfg.json.
  process.env.CFG_PATH = process.env.CFG_PATH || './cfg.json.example';
  ({ server: appServer, app, wsServer, port } = await microdrawApp.start());
  serverPort = port;
  db = app.db.mongoDB();
};

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

const closeResources = async () => {
  if (db) {
    db.close();
  }
  if (wsServer) {
    await closeServer(wsServer);
  }
  if (appServer) {
    await closeServer(appServer);
  }
};

const getServer = () => appServer;

// The Monk database of the running app (the test DB), for fixtures.
const getDB = () => db;

const width = 800;
const height = 600;

const delay = async function (delayTimeout) {
  await new Promise((resolve) => {
    setTimeout(resolve, delayTimeout);
  });
};

// Timeouts, as in BrainBox's test/utils.js.
const shortTimeout = 6 * 1000;
const mediumTimeout = 10 * 1000;
const longTimeout = 30 * 1000;

const testingCredentials = {
  username: "testing-user",
  password: "baz"
};

const insertUser = function (user) {
  return db.get('users').insert(user);
};

const insertProject = function (project) {
  return db.get('projects').insert(project);
};

const queryProject = function (shortname) {
  return db.get('projects').findOne({ shortname, backup: { $exists: 0 } });
};

const removeLocalUser = function (username) {
  return db.get('users').remove({ username });
};

const removeUser = function (nickname) {
  return db.get('users').remove({ nickname });
};

const removeProject = function (shortname) {
  return db.get('projects').remove({ shortname });
};

// Annotation documents written straight to the database, e.g. ones saved
// outside a project before H3.
const insertAnnotations = function (docs) {
  return db.get('annotations').insert(docs);
};

// Current (non-backup) annotation documents matching `query`.
const findAnnotations = function (query) {
  return db.get('annotations').find(Object.assign({ backup: { $exists: false } }, query));
};

// Annotations saved in a project, all sources and versions (test data only).
const removeProjectAnnotations = function (shortname) {
  return db.get('annotations').remove({ project: shortname });
};

// Annotations saved for a source, all slices and versions (test data only).
const removeAnnotations = function (source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return db.get('annotations').remove({ fileID: new RegExp(`^${escaped}&slice=`) });
};

// Sign up a local user. Since NeuroWebLab 0.2.0, /localSignup answers 200
// only once the user is stored (before, it answered before its insert, and
// the tests had to poll: the "no session cookie" flake of permissions.spec,
// M3), and 409 when the name exists already, e.g. when a spec signs the same
// user up again: that user can still log in with the same password. Any
// other answer (400 invalid name or password, 500) is an error.
const signUp = async (credentials) => {
  const res = await chai.request(serverOrigin()).post('/localSignup')
    .send(credentials);
  if (res.status !== 200 && res.status !== 409) {
    throw new Error(`/localSignup ${credentials.username}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res;
};

// Sign up (or find the user already there), log in, and return an agent
// with the session cookie.
const logIn = async (credentials) => {
  await signUp(credentials);
  const agent = chai.request.agent(getServer());
  const res = await agent.post('/localLogin').redirects(0)
    .send(credentials);
  chai.expect(res, `login as ${credentials.username}`).to.have.cookie('connect.sid');

  return agent;
};

const parseCookies = (str) => str
  .split(';')
  .map((v) => v.split('='))
  .reduce((acc, v) => {
    if (typeof v[0] === 'undefined' || typeof v[1] === 'undefined') {
      return acc;
    }
    acc.push({
      name: decodeURIComponent(v[0].trim()),
      value: decodeURIComponent(v[1].trim()),
      url: serverOrigin()
    });

    return acc;
  }, []);

const privateProjectTest = {
  "name": "Test project",
  "shortname": "testproject",
  "url": "",
  "created": "2022-02-03T14:59:49.786Z",
  "owner": "foo",
  "collaborators": {
    "list": [
      {
        "username": "anyone",
        "access": {
          "collaborators": "none",
          "annotations": "none",
          "files": "none"
        },
        "name": "Any User"
      }
    ]
  },
  "files": {
    "list": [{ source: "https://microdraw.pasteur.fr/test_data/cat.json", name: "Cat" }]
  },
  "annotations": {
    "list": [
      {
        "type": "vectorial",
        "values": "Set I",
        "display": true,
        "name": "layer"
      }
    ]
  }
};

const createProjectWithPermission = function (name, accessProp) {
  const access = Object.assign({}, {
    collaborators: "none",
    annotations: "none",
    files: "none"
  }, accessProp);

  const project = {
    "name": name,
    "shortname": name,
    "url": "http://foo.bar",
    "created": "2022-02-03T14:59:49.786Z",
    "owner": "foo",
    "collaborators": {
      "list": [
        {
          "username": "anyone",
          "access": {
            "collaborators": "none",
            "annotations": "none",
            "files": "none"
          },
          "name": "Any User"
        }
      ]
    },
    "files": {
      "list": [{ source: "https://microdraw.pasteur.fr/test_data/cat.json", name: "cat" }]
    },
    "annotations": {
      "list": [
        {
          "type": "vectorial",
          "values": "Set I",
          "display": true,
          "name": "layer"
        }
      ]
    }

  };

  project.collaborators.list.push({
    access,
    userID: testingCredentials.username,
    username: testingCredentials.username,
    name: testingCredentials.username
  });

  return project;
};

// A project in which anyone, logged in or not, may view the files and edit the
// annotations. Since H3, annotations are only saved inside a project, so the
// e2e specs that save open their images in one of these.
const createPublicAnnotationProject = function (shortname) {
  const project = createProjectWithPermission(shortname, { files: 'view', annotations: 'edit' });
  project.collaborators.list[0].access = { collaborators: 'none', annotations: 'edit', files: 'view' };
  project.files.list = [
    { source: '/test_data/cat.json', name: 'cat' },
    { source: '/test_data/cat-zarr.json', name: 'cat-zarr' }
  ];

  return project;
};

module.exports = {
  delay,
  shortTimeout,
  mediumTimeout,
  longTimeout,
  insertUser,
  removeUser,
  removeLocalUser,
  signUp,
  logIn,
  insertProject,
  removeProject,
  removeAnnotations,
  removeProjectAnnotations,
  insertAnnotations,
  findAnnotations,
  queryProject,
  createProjectWithPermission,
  createPublicAnnotationProject,
  initResources,
  closeResources,
  getServer,
  getDB,
  parseCookies,
  url,
  testingCredentials,
  privateProjectTest,
  width,
  height
};

// A getter, not a value: the port is only known once initResources() has run.
Object.defineProperty(module.exports, 'serverURL', { get: serverOrigin, enumerable: true });
