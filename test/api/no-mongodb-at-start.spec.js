'use strict';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');

// With no MongoDB at start the app must stop with an error, so that pm2 restarts
// it, instead of staying up with no database. The driver gives up after
// serverSelectionTimeoutMS (30 s by default): the test shortens it in the URI.
const unusedPort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// The app as pm2 runs it. Resolves with its exit code, null if it was still
// running at the deadline, and everything it printed.
const runApp = (env, deadline) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['bin/www'], {
    cwd: path.join(__dirname, '../..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const collect = (chunk) => { output += chunk; };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let hung = false;
  const timer = setTimeout(() => {
    hung = true;
    child.kill('SIGKILL');
  }, deadline);
  child.once('error', reject);
  child.once('close', (code) => {
    clearTimeout(timer);
    resolve({ code: hung ? null : code, output });
  });
});

const noMongoEnv = (port) => {
  const env = {
    ...process.env,
    MONGODB: `127.0.0.1:${port}/nomongodb?serverSelectionTimeoutMS=300`,
    PORT: '0',
    WS_PORT: '0',
    CFG_PATH: './cfg.json.example',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test'
  };
  delete env.MONGODB_TEST;

  return env;
};

describe('Start with no MongoDB', function () {
  it('exits non-zero and says why', async function () {
    const port = await unusedPort();

    const { code, output } = await runApp(noMongoEnv(port), U.shortTimeout);

    assert.isNotNull(code, 'the app was still running at the deadline');
    assert.notEqual(code, 0);
    const fatal = output.split('\n').find((line) => line.includes('"level":60'));
    assert.exists(fatal, `no fatal line in: ${output}`);
    const { msg } = JSON.parse(fatal);
    assert.include(msg, 'cannot connect to MongoDB');
    assert.notInclude(msg, String(port), 'the connection string stays out of the message');
  }).timeout(U.mediumTimeout);
});
