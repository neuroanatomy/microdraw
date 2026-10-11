const microdrawApp = require('../app/app');

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

module.exports = {
  delay,
  shortTimeout,
  mediumTimeout,
  longTimeout,
  insertUser,
  removeUser,
  removeLocalUser,
  insertProject,
  removeProject,
  queryProject,
  createProjectWithPermission,
  initResources,
  closeResources,
  getServer,
  parseCookies,
  url,
  testingCredentials,
  privateProjectTest,
  width,
  height
};

// A getter, not a value: the port is only known once initResources() has run.
Object.defineProperty(module.exports, 'serverURL', { get: serverOrigin, enumerable: true });
