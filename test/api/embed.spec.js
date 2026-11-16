/* eslint-disable max-lines, max-statements */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const WebSocket = require('ws');
const U = require('../mocha.test.util');
const wsModule = require('../../app/controller/microdrawWebsocketServer/microdrawWebsocketServer');
const { WS_TICKET_COLLECTION, WS_TICKET_DURATION } = require('neuroweblab');

// The embeddable, read-only viewer (T002 3.7), as BrainBox's /mri/embed:
// - GET /data/embed: access matrix, parameter whitelist, CSP on that route only;
// - GET /data/layers: the projects an embedding page may show;
// - GET /project/:p/embed: the settings' "Embed Project" button;
// - writes refused from the embed, over HTTP and over the WebSocket;
// - the WebSocket ticket: lifetime and scope.
describe('Embeddable viewer (T002 3.7)', function () {
  const PUBLIC_SRC = 'https://embed.test/public.json';
  const PRIVATE_SRC = 'https://embed.test/private.json';
  const OTHER_SRC = 'https://embed.test/other.json';
  const UNKNOWN_SRC = 'https://embed.test/unknown.json';
  const editor = { username: 'embededitor', password: 'embed-editor-password' };
  const viewer = { username: 'embedviewer', password: 'embed-viewer-password' };

  const access = (files, annotations) => ({ collaborators: 'none', annotations, files });
  const row = (username, a) => ({ username, userID: username, name: username, access: a });
  const project = (shortname, anyone, source, others = []) => ({
    name: `Embed ${shortname}`,
    shortname,
    url: '',
    created: '2026-11-15T00:00:00.000Z',
    owner: 'embedowner',
    collaborators: { list: [{ username: 'anyone', name: 'Any User', access: anyone }, ...others] },
    files: { list: [{ source, name: 'data' }] },
    annotations: { list: [{ type: 'vectorial', values: '10 regions', display: true, name: 'regions' }] }
  });
  const publicProject = project('embedpublic', access('view', 'view'), PUBLIC_SRC, [row(editor.username, access('view', 'edit'))]);
  const privateProject = project('embedprivate', access('none', 'none'), PRIVATE_SRC, [row(viewer.username, access('view', 'view'))]);
  const otherProject = project('embedother', access('view', 'view'), OTHER_SRC);
  const PROJECTS = [publicProject, privateProject, otherProject];

  let editorAgent, port, viewerAgent;
  const sockets = [];

  const embed = (query, agent = null) => (agent || chai.request(U.serverURL)).get('/data/embed')
    .query(query);
  const layers = (source, agent = null) => (agent || chai.request(U.serverURL)).get('/data/layers')
    .query({ source });
  const ticketIn = (html) => {
    const m = html.match(/var embedWsTicket = "([0-9a-f]+)";/);
    assert.isNotNull(m, 'the page holds a ticket');

    return m[1];
  };

  // A connection that keeps every message it gets, in order
  const connect = (query = '', cookie = null) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${query}`, cookie ? { headers: { Cookie: cookie } } : {});
    ws.inbox = [];
    ws.waiting = [];
    ws.on('message', (msg) => {
      const data = JSON.parse(String(msg));
      const waiter = ws.waiting.shift();
      if (waiter) { waiter(data); } else { ws.inbox.push(data); }
    });
    ws.once('open', () => {
      sockets.push(ws);
      resolve(ws);
    });
    ws.once('error', reject);
  });
  const nextMessage = (ws) => (ws.inbox.length > 0 ?
    Promise.resolve(ws.inbox.shift()) :
    new Promise((resolve) => { ws.waiting.push(resolve); }));
  const join = (ws, target) => {
    ws.send(JSON.stringify({ type: 'join', ...target }));

    return nextMessage(ws);
  };
  const at = (source, p, slice = '0') => ({ project: p.shortname, source, slice });
  const embedSocket = async (query) => connect(`?embedTicket=${ticketIn((await embed(query)).text)}`);

  const saveBody = (target, uid) => ({
    action: 'save',
    ...target,
    Hash: 'embed',
    annotation: JSON.stringify({
      Regions: [{ name: 'Region 1', uid, path: ['Path', { segments: [[0, 0], [10, 10], [20, 0]], closed: true }] }],
      RegionsToRemove: []
    })
  });

  before(async function () {
    ({ port } = wsModule.server.address());
    await Promise.all(PROJECTS.map((p) => U.removeProject(p.shortname)));
    await U.insertProject(PROJECTS.map((p) => ({ ...p })));
    editorAgent = await U.logIn(editor);
    viewerAgent = await U.logIn(viewer);
  });

  after(async function () {
    sockets.forEach((ws) => ws.terminate());
    await Promise.all(PROJECTS.map((p) => U.removeProject(p.shortname)));
    await Promise.all([PUBLIC_SRC, PRIVATE_SRC, OTHER_SRC].map((s) => U.removeAnnotations(s)));
    await U.getDB().collection(WS_TICKET_COLLECTION)
      .deleteMany({ source: { $in: [PUBLIC_SRC, PRIVATE_SRC, OTHER_SRC] } });
    await U.removeLocalUser(editor.username);
    await U.removeLocalUser(viewer.username);
    // agent.close() would close the shared server (as user-tabs.spec.js)
  });

  describe('GET /data/embed: access', function () {
    const cases = [
      ['no source', {}, 400, 'No dataset was requested.'],
      ['a public dataset in its project', { source: PUBLIC_SRC, project: 'embedpublic' }, 200],
      ['a public dataset, no project: the image alone', { source: PUBLIC_SRC }, 200],
      ['a private dataset in its project, logged out', { source: PRIVATE_SRC, project: 'embedprivate' }, 403, 'This content is private.'],
      ['a private dataset, no project', { source: PRIVATE_SRC }, 403, 'This content is private.'],
      ['an unknown dataset', { source: UNKNOWN_SRC }, 404, 'This dataset could not be found.'],
      ['an unknown project', { source: PUBLIC_SRC, project: 'embednosuchproject' }, 404, 'This project could not be found.'],
      ['a project not listing the dataset', { source: PUBLIC_SRC, project: 'embedother' }, 404, 'This dataset could not be found.']
    ];
    for (const [title, query, status, message] of cases) {
      it(`${title}: ${status}`, async function () {
        const res = await embed(query);
        assert.equal(res.status, status);
        if (message) {
          assert.include(res.text, `<p id="embedErrorMessage">${message}</p>`);
          assert.notInclude(res.text, 'embedWsTicket');
        } else {
          ticketIn(res.text);
        }
      }).timeout(U.shortTimeout);
    }

    it('a collaborator of the private project, logged in: 200', async function () {
      const res = await embed({ source: PRIVATE_SRC, project: 'embedprivate' }, viewerAgent);
      assert.equal(res.status, 200);
      ticketIn(res.text);
    }).timeout(U.shortTimeout);

    it('no drawing, saving, chat or script in the page', async function () {
      const res = await embed({ source: PUBLIC_SRC, project: 'embedpublic' });
      for (const absent of ['microdraw.js', 'toolsFull', 'microdraw-ws.js', 'consolita', 'id="save"', 'id="msg"']) {
        assert.notInclude(res.text, absent);
      }
      assert.include(res.text, '/js/embed-page.js');
    }).timeout(U.shortTimeout);
  });

  describe('GET /data/embed: parameters and headers', function () {
    it('reflects only the whitelisted parameters, escaped', async function () {
      const res = await embed({
        source: PUBLIC_SRC,
        project: 'embedpublic',
        slice: '</script><script>alert(1)</script>',
        injected: 'embedInjectedValue',
        token: 'embedSecretToken'
      });
      assert.equal(res.status, 200);
      assert.notInclude(res.text, 'embedInjectedValue');
      assert.notInclude(res.text, 'embedSecretToken');
      assert.notInclude(res.text, '<script>alert(1)');
      assert.include(res.text, '\\u003c/script\\u003e');
      const params = JSON.parse(res.text.match(/var params = (.*);/)[1]);
      assert.deepEqual(Object.keys(params).sort(), ['project', 'slice', 'source']);
    }).timeout(U.shortTimeout);

    it('frame-ancestors * on the embed route, its error pages too, and not on the others', async function () {
      assert.equal((await embed({ source: PUBLIC_SRC })).headers['content-security-policy'], 'frame-ancestors *');
      assert.equal((await embed({ source: UNKNOWN_SRC })).headers['content-security-policy'], 'frame-ancestors *');
      const others = await Promise.all([
        chai.request(U.serverURL).get('/data')
          .query({ source: PUBLIC_SRC }),
        layers(PUBLIC_SRC),
        chai.request(U.serverURL).get('/')
      ]);
      others.forEach((res) => assert.isUndefined(res.headers['content-security-policy'], res.req.path));
    }).timeout(U.shortTimeout);
  });

  describe('GET /data/layers', function () {
    it('a public dataset: its project, with the visitor\'s access', async function () {
      const res = await layers(PUBLIC_SRC);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { layers: [{ project: 'embedpublic', name: 'Embed embedpublic', access: 'view' }] });
      const asEditor = await layers(PUBLIC_SRC, editorAgent);
      assert.deepEqual(asEditor.body.layers.map((l) => l.access), ['edit']);
    }).timeout(U.shortTimeout);

    it('a private dataset: 403 logged out, its project for a collaborator', async function () {
      assert.equal((await layers(PRIVATE_SRC)).status, 403);
      const res = await layers(PRIVATE_SRC, viewerAgent);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.layers.map((l) => l.project), ['embedprivate']);
    }).timeout(U.shortTimeout);

    it('an unknown dataset 404, no source 400', async function () {
      assert.equal((await layers(UNKNOWN_SRC)).status, 404);
      assert.equal((await chai.request(U.serverURL).get('/data/layers')).status, 400);
    }).timeout(U.shortTimeout);
  });

  describe('GET /project/:p/embed (the Embed Project button)', function () {
    it('opens the embed of the project\'s first dataset', async function () {
      const res = await chai.request(U.serverURL).get('/project/embedpublic/embed')
        .redirects(0);
      assert.equal(res.status, 302);
      const location = new URL(res.headers.location, U.serverURL);
      assert.equal(location.pathname, '/data/embed');
      assert.deepEqual(Object.fromEntries(location.searchParams), { source: PUBLIC_SRC, project: 'embedpublic' });
    }).timeout(U.shortTimeout);

    it('a private project: 403, and no dataset URL; an unknown one: 404', async function () {
      const res = await chai.request(U.serverURL).get('/project/embedprivate/embed')
        .redirects(0);
      assert.equal(res.status, 403);
      assert.isUndefined(res.headers.location);
      assert.notInclude(res.text, PRIVATE_SRC);
      assert.equal((await chai.request(U.serverURL).get('/project/embednosuchproject/embed')
        .redirects(0)).status, 404);
    }).timeout(U.shortTimeout);
  });

  describe('writes from the embed are refused over HTTP', function () {
    const target = at(PUBLIC_SRC, publicProject);
    const signals = [
      ['the embed header', (r) => r.set('X-Microdraw-Embed', 'any')],
      ['the embed header, empty', (r) => r.set('X-Microdraw-Embed', '')],
      ['a Referer from the embed page', (r) => r.set('Referer', `${U.serverURL}/data/embed?source=x`)],
      ['Sec-Fetch-Dest: iframe', (r) => r.set('Sec-Fetch-Dest', 'iframe')]
    ];
    const markedSave = (mark, uid) => mark(editorAgent.post('/api')).send(saveBody(target, uid));
    for (const [title, mark] of signals) {
      it(`POST /api save with ${title}: 403, nothing stored`, async function () {
        const uid = `embed-${title.replace(/\W+/g, '-')}`;
        const res = await markedSave(mark, uid);
        assert.equal(res.status, 403);
        assert.deepEqual(res.body, { error: 'An embedded viewer cannot edit' });
        assert.lengthOf(await U.findAnnotations({ project: 'embedpublic', 'annotation.uid': uid }), 0);
      }).timeout(U.shortTimeout);
    }

    it('the same save without them is stored (control)', async function () {
      const res = await editorAgent.post('/api').send(saveBody(target, 'embed-control'));
      assert.equal(res.status, 200, res.text);
      assert.lengthOf(await U.findAnnotations({ project: 'embedpublic', 'annotation.uid': 'embed-control' }), 1);
    }).timeout(U.shortTimeout);

    it('an upload and a text annotation with the embed header: 403', async function () {
      const upload = await editorAgent.post('/api/upload')
        .query({ action: 'append', ...target })
        .set('X-Microdraw-Embed', 'any')
        .attach('data', Buffer.from(JSON.stringify([{ annotation: { name: 'up', path: ['Path', {}] } }])), 'a.json');
      assert.equal(upload.status, 403);
      const text = await editorAgent.post('/api/text-annotation')
        .set('X-Microdraw-Embed', 'any')
        .send({ project: 'embedpublic', source: PUBLIC_SRC, layer: 'notes', value: 'x' });
      assert.equal(text.status, 403);
    }).timeout(U.shortTimeout);

    it('reads with the header still work', async function () {
      const res = await chai.request(U.serverURL).get('/api')
        .query(target)
        .set('X-Microdraw-Embed', 'any');
      assert.equal(res.status, 200);
    }).timeout(U.shortTimeout);
  });

  describe('the WebSocket ticket', function () {
    it('lives 6 h, scoped to the dataset, the project and the user the page was rendered for', async function () {
      const before = Date.now();
      const res = await embed({ source: PUBLIC_SRC, project: 'embedpublic' }, editorAgent);
      const ticket = await U.getDB().collection(WS_TICKET_COLLECTION)
        .findOne({ token: ticketIn(res.text) });
      assert.include(ticket, { source: PUBLIC_SRC, project: 'embedpublic', username: editor.username });
      assert.equal(WS_TICKET_DURATION, 6 * 3600 * 1000);
      const lifetime = ticket.expiryDate.getTime() - before;
      assert.isAtLeast(lifetime, WS_TICKET_DURATION - 1000);
      assert.isAtMost(lifetime, WS_TICKET_DURATION + 5000);
    }).timeout(U.shortTimeout);

    it('joins its slice\'s room, and gets another user\'s saves, without a cookie', async function () {
      const target = at(PUBLIC_SRC, publicProject);
      const ws = await embedSocket({ source: PUBLIC_SRC, project: 'embedpublic' });
      assert.deepEqual(await join(ws, target), { type: 'joined', ...target });
      const res = await editorAgent.post('/api').send(saveBody(target, 'embed-live'));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await nextMessage(ws), { type: 'saved', ...target });
    }).timeout(U.shortTimeout);

    it('cannot join another dataset\'s room, nor another project\'s', async function () {
      const ws = await embedSocket({ source: PUBLIC_SRC, project: 'embedpublic' });
      assert.include(await join(ws, at(OTHER_SRC, otherProject)), { type: 'join-refused', reason: 'out-of-scope' });
      assert.include(await join(ws, at(PUBLIC_SRC, otherProject)), { type: 'join-refused', reason: 'out-of-scope' });
      // a normal connection may join that room (control)
      const normal = await connect();
      assert.include(await join(normal, at(OTHER_SRC, otherProject)), { type: 'joined' });
    }).timeout(U.shortTimeout);

    it('an expired, unknown or empty ticket gives no access', async function () {
      const token = 'e'.repeat(48);
      await U.getDB().collection(WS_TICKET_COLLECTION)
        .insertOne({
          token,
          source: PUBLIC_SRC,
          project: 'embedpublic',
          username: null,
          createdAt: new Date(Date.now() - (2 * WS_TICKET_DURATION)),
          expiryDate: new Date(Date.now() - 1000)
        });
      const target = at(PUBLIC_SRC, publicProject);
      for (const query of [`?embedTicket=${token}`, '?embedTicket=nosuchticket', '?embedTicket=']) {
        // eslint-disable-next-line no-await-in-loop -- one at a time
        const ws = await connect(query);
        // eslint-disable-next-line no-await-in-loop
        assert.include(await join(ws, target), { type: 'join-refused', reason: 'out-of-scope' }, query);
      }
    }).timeout(U.shortTimeout);

    it('a chat (a write) on an embed connection is refused and relayed to nobody', async function () {
      const ws = await embedSocket({ source: PUBLIC_SRC, project: 'embedpublic' });
      const observer = await connect();
      const probe = await connect();
      ws.send(JSON.stringify({ type: 'chat', msg: 'embed-chat', username: 'x' }));
      assert.deepEqual(await nextMessage(ws), { type: 'write-refused', write: 'chat', reason: 'an embedded viewer cannot edit' });
      probe.send(JSON.stringify({ type: 'chat', msg: 'embed-probe' }));
      // the server relays in order: the probe comes first if the chat was dropped
      assert.include(await nextMessage(observer), { type: 'chat', msg: 'embed-probe' });
      // and the embed connection is sent no chat: a join's answer comes before any later one
      const target = at(PUBLIC_SRC, publicProject);
      assert.deepEqual(await join(ws, target), { type: 'joined', ...target });
    }).timeout(U.shortTimeout);
  });
});
