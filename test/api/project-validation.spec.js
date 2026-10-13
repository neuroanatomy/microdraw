/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const _ = require('lodash');
const U = require('../mocha.test.util');
const { plainText } = require('../../app/controller/project/project.validation');
const { projectProblems } = require('../../app/controller/project/project.check');

// M3 (T002 step 1.4): POST /project/json/:projectName validates and sanitises
// the project, as BrainBox's isProjectObject, adapted to microdraw (D27).
const member = { username: 'm3a-member', password: 'm3a-member-password' };
const collaborator = { username: 'm3a-collaborator', name: 'M3a Collaborator' };
const editor = { username: 'm3a-editor', password: 'm3a-editor-password' };

const anyone = (access = {}) => ({
  username: 'anyone',
  name: 'Any User',
  access: { collaborators: 'none', annotations: 'none', files: 'none', ...access }
});

const newProject = (shortname, extra = {}) => ({
  name: 'M3a project',
  shortname,
  url: '',
  description: '',
  created: '2026-10-12T00:00:00.000Z',
  collaborators: { list: [anyone({ files: 'view' })] },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set 1', display: true }] },
  ...extra
});

// Signs up (or finds the user already there) and logs in (U.logIn).
const login = (credentials) => U.logIn(credentials);

const isJSON = (res) => assert.match(res.headers['content-type'], /^application\/json/);

// eslint-disable-next-line max-statements
describe('Validation of POST /project/json/:projectName (M3)', function () {
  let agent, editorAgent;
  const created = [];

  const post = (shortname, data) => agent.post(`/project/json/${shortname}`).send({ data });

  // Posts a new project and expects a 400 JSON answer and nothing stored.
  const refused = async (shortname, data, message) => {
    created.push(shortname, data.shortname);
    const res = await post(shortname, data);
    assert.equal(res.status, 400, res.text);
    isJSON(res);
    assert.isFalse(res.body.success);
    if (message) {
      assert.match(res.body.message, message);
    }
    assert.isNull(await U.queryProject(shortname));

    return res;
  };

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.mediumTimeout);
    await U.insertUser({ ...collaborator });
    agent = await login(member);
    editorAgent = await login(editor);
  });

  after(async function () {
    await Promise.all([
      ...created.map((shortname) => U.removeProject(shortname)),
      U.removeLocalUser(member.username),
      U.removeLocalUser(editor.username),
      U.removeLocalUser(collaborator.username)
    ]);
  });

  describe('accepted projects', function () {
    it('a valid new project is stored, owned by its creator, answered as JSON', async function () {
      const shortname = 'm3avalid';
      created.push(shortname);
      const res = await post(shortname, newProject(shortname, { owner: 'someone-else' }));
      assert.equal(res.status, 200, res.text);
      isJSON(res);
      assert.isTrue(res.body.success);
      const stored = await U.queryProject(shortname);
      assert.equal(stored.owner, member.username);
      assert.deepEqual(stored.files.list, [{ source: '/test_data/cat.json', name: 'cat' }]);
    }).timeout(U.shortTimeout);

    it('accepts collaborators named by username, by userID, or both', async function () {
      const shortname = 'm3acollabkeys';
      created.push(shortname);
      const access = { collaborators: 'view', annotations: 'edit', files: 'view' };
      const project = newProject(shortname);
      project.collaborators.list.push({ username: collaborator.username, access });
      project.collaborators.list.push({ userID: member.username, access });
      project.collaborators.list.push({ username: collaborator.username, userID: collaborator.username, name: 'X', access });
      const res = await post(shortname, JSON.stringify(project));
      assert.equal(res.status, 200, res.text);
      assert.lengthOf((await U.queryProject(shortname)).collaborators.list, 4);
    }).timeout(U.shortTimeout);

    it('accepts an absolute http(s) URL as a file source, "&" included', async function () {
      const shortname = 'm3aurlsource';
      created.push(shortname);
      const source = 'https://example.org/img.dzi?a=1&b=2';
      const res = await post(shortname, newProject(shortname, { files: { list: [{ source, name: 'img' }] } }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await U.queryProject(shortname)).files.list[0].source, source);
    }).timeout(U.shortTimeout);
  });

  describe('sanitising', function () {
    it('plainText removes markup and keeps text, "&" and "a < b"', function () {
      assert.equal(plainText('<img src=x onerror=alert(1)>Name'), 'Name');
      assert.equal(plainText('<script>alert(1)</script>ok'), 'ok');
      assert.equal(plainText('<b>bold</b>'), 'bold');
      assert.equal(plainText('a < b'), 'a < b');
      assert.equal(plainText('x?a=1&b=2'), 'x?a=1&b=2');
    });

    // M5b (dompurify 2 → 3): entities, comments, javascript: links and two
    // mutation-XSS payloads; recorded on dompurify 2.5.9.
    it('plainText decodes entities and drops comments, links and mXSS payloads', function () {
      assert.equal(plainText('<b>x</b>&amp;y'), 'x&y');
      assert.equal(plainText('<!-- c -->k'), 'k');
      assert.equal(plainText('<a href="javascript:alert(1)">l</a>'), 'l');
      assert.equal(plainText('<noscript><p title="</noscript><img src=x onerror=alert(1)>">'), '');
      assert.equal(plainText('<math><mi><mglyph><style><img src=x onerror=alert(1)>'), '');
    });

    // eslint-disable-next-line max-statements
    it('stores names without markup, and ignores _id and backup', async function () {
      const shortname = 'm3asanitise';
      created.push(shortname);
      const project = newProject(shortname, {
        name: '<img src=x onerror=alert(1)>Clean name',
        description: '<script>alert(1)</script>About',
        backup: true,
        _id: '0123456789abcdef01234567'
      });
      project.annotations.list[0].name = '<b onclick="x()">Layer</b>';
      project.files.list[0].name = '<i onmouseover="alert(1)">cat</i>';
      project.url = '<svg onload=alert(1)>x';
      const res = await post(shortname, project);
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.isNotNull(stored, 'stored without backup');
      assert.equal(stored.name, 'Clean name');
      assert.equal(stored.description, 'About');
      assert.equal(stored.annotations.list[0].name, 'Layer');
      assert.equal(stored.files.list[0].name, 'cat');
      assert.notInclude(stored.url, '<');
      assert.notEqual(String(stored._id), '0123456789abcdef01234567');
    }).timeout(U.shortTimeout);
  });

  // eslint-disable-next-line max-statements
  describe('refused projects (400, nothing stored)', function () {
    it('the shortname in the data differs from the one in the URL', async function () {
      await refused('m3aurlname', newProject('m3abodyname'), /URL/);
      assert.isNull(await U.queryProject('m3abodyname'));
    }).timeout(U.shortTimeout);

    it('a new project without lists', async function () {
      await refused('m3anolists', { shortname: 'm3anolists', name: 'x' }, /list/);
    }).timeout(U.shortTimeout);

    it('a collaborators list without an "anyone" entry', async function () {
      const project = newProject('m3anoanyone');
      project.collaborators.list = [{ username: collaborator.username, access: { collaborators: 'view', annotations: 'view', files: 'view' } }];
      await refused('m3anoanyone', project, /anyone/);
    }).timeout(U.shortTimeout);

    it('an invalid access value', async function () {
      const project = newProject('m3abadaccess');
      project.collaborators.list[0].access.files = 'admin';
      await refused('m3abadaccess', project, /access/);
    }).timeout(U.shortTimeout);

    it('a collaborator who does not exist', async function () {
      const project = newProject('m3anouser');
      project.collaborators.list.push({ username: 'm3a-no-such-user', access: { collaborators: 'none', annotations: 'view', files: 'view' } });
      await refused('m3anouser', project, /m3a-no-such-user/);
    }).timeout(U.shortTimeout);

    it('a collaborator with a different username and userID', async function () {
      const project = newProject('m3anoname');
      project.collaborators.list.push({ username: collaborator.username, userID: member.username, access: { collaborators: 'none', annotations: 'view', files: 'view' } });
      await refused('m3anoname', project, /different/);
    }).timeout(U.shortTimeout);

    it('a new shortname that is not alphanumeric', async function () {
      await refused('m3a-hyphen', newProject('m3a-hyphen'), /letters and numbers/);
    }).timeout(U.shortTimeout);

    it('a file that is not {name, source}', async function () {
      await refused('m3afilestring', newProject('m3afilestring', { files: { list: ['/test_data/cat.json'] } }));
      await refused('m3afilenosource', newProject('m3afilenosource', { files: { list: [{ name: 'cat' }] } }));
      await refused('m3afilenoname', newProject('m3afilenoname', { files: { list: [{ source: '/test_data/cat.json' }] } }));
    }).timeout(U.shortTimeout);

    it('a javascript: or data: file source', async function () {
      // eslint-disable-next-line no-script-url
      await refused('m3ajssource', newProject('m3ajssource', { files: { list: [{ source: 'javascript:alert(1)', name: 'x' }] } }));
      await refused('m3adatasource', newProject('m3adatasource', { files: { list: [{ source: 'data:text/html,x', name: 'x' }] } }));
    }).timeout(U.shortTimeout);

    it('an annotation type other than text or vectorial', async function () {
      const project = newProject('m3avolume');
      project.annotations.list[0].type = 'volume';
      await refused('m3avolume', project, /type/);
    }).timeout(U.shortTimeout);

    it('a name that is not a string', async function () {
      await refused('m3anamenumber', newProject('m3anamenumber', { name: { $gt: '' } }));
    }).timeout(U.shortTimeout);
  });

  // eslint-disable-next-line max-statements
  describe('updates', function () {
    const shortname = 'm3aupdate';
    const access = (files, collaborators = 'view', annotations = 'view') => ({ collaborators, annotations, files });
    const stored = () => ({
      name: 'M3a update',
      shortname,
      url: '',
      owner: member.username,
      collaborators: {
        list: [
          anyone(),
          { username: editor.username, userID: editor.username, access: access('edit') },
          // a user that no longer exists
          { username: 'm3a-removed-user', access: access('view') }
        ]
      },
      files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
      annotations: { list: [{ type: 'vectorial', name: 'layer', values: 'Set 1', display: true }] }
    });

    beforeEach(async function () {
      await U.removeProject(shortname);
      await U.insertProject(stored());
    });

    after(async function () {
      await U.removeProject(shortname);
    });

    const postAs = (who, data) => who.post(`/project/json/${shortname}`).send({ data });

    it('keeps the stored owner (a collaborator cannot take the project)', async function () {
      const res = await postAs(editorAgent, { ...stored(), owner: editor.username });
      assert.equal(res.status, 200, res.text);
      assert.equal((await U.queryProject(shortname)).owner, member.username);
    }).timeout(U.shortTimeout);

    it('a collaborator who may only view the collaborators cannot change their access', async function () {
      const project = stored();
      project.collaborators.list[1].access = access('remove', 'remove', 'remove');
      project.collaborators.list[0].access = access('remove', 'remove', 'remove');
      const res = await postAs(editorAgent, project);
      assert.equal(res.status, 200, res.text);
      assert.match(res.body.message, /ignored/);
      const after = await U.queryProject(shortname);
      assert.deepEqual(after.collaborators.list[1].access, access('edit'));
      assert.deepEqual(after.collaborators.list[0].access, anyone().access);
    }).timeout(U.shortTimeout);

    it('a collaborator who may only view the annotations cannot change the layers', async function () {
      const project = stored();
      project.annotations.list[0].type = 'text';
      project.annotations.list[0].name = 'renamed';
      const res = await postAs(editorAgent, project);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await U.queryProject(shortname)).annotations.list, stored().annotations.list);
    }).timeout(U.shortTimeout);

    it('saving again a project that names a removed user is still possible', async function () {
      const res = await postAs(agent, { ...stored(), name: 'renamed by the owner' });
      assert.equal(res.status, 200, res.text);
      assert.equal((await U.queryProject(shortname)).name, 'renamed by the owner');
    }).timeout(U.shortTimeout);

    it('an existing shortname that is not alphanumeric can still be saved', async function () {
      const legacy = { ...stored(), shortname: 'm3a-legacy' };
      created.push(legacy.shortname);
      await U.insertProject(_.cloneDeep(legacy));
      const res = await agent.post(`/project/json/${legacy.shortname}`).send({ data: { ...legacy, name: 'legacy renamed' } });
      assert.equal(res.status, 200, res.text);
      assert.equal((await U.queryProject(legacy.shortname)).name, 'legacy renamed');
    }).timeout(U.shortTimeout);

    it('the body cannot overwrite another project than the one in the URL', async function () {
      const other = 'm3aother';
      created.push(other);
      await U.insertProject({ ...stored(), shortname: other, name: 'other' });
      const res = await postAs(agent, { ...stored(), shortname: other, name: 'overwritten' });
      assert.equal(res.status, 400);
      assert.equal((await U.queryProject(other)).name, 'other');
    }).timeout(U.shortTimeout);

    it('anonymous saves answer 401 JSON', async function () {
      const res = await chai.request(U.serverURL).post(`/project/json/${shortname}`)
        .send({ data: stored() });
      assert.equal(res.status, 401);
      isJSON(res);
    }).timeout(U.shortTimeout);
  });

  // M3a2: 21 of the 76 production projects held rows that M3a refused, most of
  // them blank rows left by the settings page's "+" button, so they could no
  // longer be saved. Rows stored unchanged are accepted as they are; blank new
  // rows are dropped; new or changed rows must be valid.
  // eslint-disable-next-line max-statements
  describe('stored rows and blank rows (M3a2)', function () {
    const shortname = 'm3a2legacy';
    const none = { collaborators: 'none', annotations: 'none', files: 'none' };
    const legacy = () => ({
      name: 'M3a2 legacy',
      shortname,
      url: '',
      owner: member.username,
      collaborators: { list: [anyone({ files: 'view' }), { username: '', name: '', access: none }] },
      files: { list: [{ source: '/test_data/cat.json', name: 'cat' }, { source: '', name: '' }, { source: '', name: 'no source' }] },
      annotations: { list: [{ type: 'text', name: null, values: null, display: true }, { type: 'vectorial', values: 'Set 1', display: true }] }
    });
    const save = (data) => agent.post(`/project/json/${shortname}`).send({ data });

    beforeEach(async function () {
      await U.removeProject(shortname);
      await U.insertProject(legacy());
    });

    after(async function () {
      await U.removeProject(shortname);
    });

    it('a stored project with an unnamed annotation, a file without source and a collaborator without username can be saved again unchanged', async function () {
      const res = await save({ ...legacy(), name: 'saved again' });
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.equal(stored.name, 'saved again');
      assert.lengthOf(stored.annotations.list, 2);
      assert.lengthOf(stored.files.list, 3);
      assert.lengthOf(stored.collaborators.list, 2);
    }).timeout(U.shortTimeout);

    it('stored rows are recognised whatever their position', async function () {
      const project = legacy();
      project.files.list.reverse();
      project.annotations.list.reverse();
      const res = await save(project);
      assert.equal(res.status, 200, res.text);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('blank new rows are dropped, not refused, and counted in the answer', async function () {
      const project = legacy();
      project.annotations.list.push({ type: 'text', name: '', values: '', display: true });
      project.files.list.push({ source: '', name: '' });
      project.collaborators.list.push({ username: '', name: '', access: none });
      const res = await save(project);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.dropped, { files: 1, collaborators: 1, annotations: 1 });
      assert.match(res.body.message, /Empty rows were not saved/);
      const stored = await U.queryProject(shortname);
      assert.lengthOf(stored.annotations.list, 2);
      assert.lengthOf(stored.files.list, 3);
      assert.lengthOf(stored.collaborators.list, 2);
    }).timeout(U.shortTimeout);

    it('a new annotation without a name is still refused', async function () {
      const project = legacy();
      project.annotations.list.push({ type: 'vectorial', name: '', values: 'Set 2', display: true });
      const res = await save(project);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /needs a name/);
    }).timeout(U.shortTimeout);

    // eslint-disable-next-line max-statements
    it('a stored blank row changed into an invalid one is refused', async function () {
      const project = legacy();
      // eslint-disable-next-line no-script-url
      project.files.list[1] = { source: 'javascript:alert(1)', name: '' };
      let res = await save(project);
      assert.equal(res.status, 400);
      const other = legacy();
      other.annotations.list[0] = { type: 'text', name: null, values: 'Set 1', display: true };
      res = await save(other);
      assert.equal(res.status, 400);
      assert.equal((await U.queryProject(shortname)).name, 'M3a2 legacy');
    }).timeout(U.shortTimeout);

    // The settings page sends a file stored as a string s back as
    // {source: s, name: <after the last '/'>}, and may send '' for null.
    it('rows normalised by the settings page still count as stored', async function () {
      const stored = legacy();
      stored.files.list.push('http://m3a2.localhost/with space.dzi');
      await U.removeProject(shortname);
      await U.insertProject(stored);
      const sent = legacy();
      sent.files.list.push({ source: 'http://m3a2.localhost/with space.dzi', name: 'with space.dzi' });
      sent.annotations.list[0] = { type: 'text', name: '', values: '', display: true };
      const res = await save(sent);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.dropped, { files: 0, collaborators: 0, annotations: 0 });
    }).timeout(U.shortTimeout);

    it('a stored invalid string file cannot be changed into another invalid one', async function () {
      const stored = legacy();
      stored.files.list.push('http://m3a2.localhost/with space.dzi');
      await U.removeProject(shortname);
      await U.insertProject(stored);
      const sent = legacy();
      sent.files.list.push({ source: 'http://m3a2.localhost/other space.dzi', name: 'with space.dzi' });
      const res = await save(sent);
      assert.equal(res.status, 400);
    }).timeout(U.shortTimeout);

    it('a new project drops its blank rows', async function () {
      const name = 'm3a2newblank';
      created.push(name);
      const project = newProject(name);
      project.files.list.push({ source: '', name: '' });
      const res = await agent.post(`/project/json/${name}`).send({ data: project });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.dropped.files, 1);
      assert.lengthOf((await U.queryProject(name)).files.list, 1);
    }).timeout(U.shortTimeout);
  });

  // F1: two annotation layers cannot have the same name, compared ignoring
  // case and surrounding spaces, as A2's name-layers checks (one function);
  // duplicates already stored are accepted unchanged (M3a2)
  // eslint-disable-next-line max-statements
  describe('duplicate layer names (F1)', function () {
    const shortname = 'f1dupes';
    const layer = (name, values = '') => ({ type: 'vectorial', name, values, display: true });
    const stored = () => ({
      ...newProject(shortname),
      owner: member.username,
      annotations: { list: [layer('Cortex', 'Set 1'), layer('CORTEX', 'Set 2'), layer('Other')] }
    });
    const save = (data) => agent.post(`/project/json/${shortname}`).send({ data });

    beforeEach(async function () {
      await U.removeProject(shortname);
      await U.insertProject(stored());
    });

    after(async function () {
      await U.removeProject(shortname);
    });

    it('a new project with two layers of the same name, ignoring case, is refused', async function () {
      const project = newProject('f1dupesnew');
      project.annotations.list.push(layer(' LAYER '));
      await refused('f1dupesnew', project, /same name/);
    }).timeout(U.shortTimeout);

    it('stored duplicates are accepted unchanged, and new layers with other names too', async function () {
      let res = await save({ ...stored(), name: 'saved again' });
      assert.equal(res.status, 200, res.text);
      const project = stored();
      project.annotations.list.push(layer('Third'));
      res = await save(project);
      assert.equal(res.status, 200, res.text);
      assert.lengthOf((await U.queryProject(shortname)).annotations.list, 4);
    }).timeout(U.shortTimeout);

    it('a new layer named as an existing one is refused', async function () {
      const project = stored();
      project.annotations.list.push(layer('other'));
      const res = await save(project);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /same name/);
      assert.lengthOf((await U.queryProject(shortname)).annotations.list, 3);
    }).timeout(U.shortTimeout);

    it('a layer renamed, or a stored duplicate changed, is refused', async function () {
      let project = stored();
      project.annotations.list[2] = layer('cortex ');
      let res = await save(project);
      assert.equal(res.status, 400);
      project = stored();
      project.annotations.list[1] = layer('CORTEX', 'Set 3');
      res = await save(project);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /same name/);
    }).timeout(U.shortTimeout);

    it('the stored-project check reports stored duplicates as warnings', function () {
      const problems = projectProblems(stored(), new Set([member.username]));
      const duplicates = problems.filter((q) => (/same name/).test(q.message));
      assert.lengthOf(duplicates, 1);
      assert.deepInclude(duplicates[0], { kind: 'warning', list: 'annotations', row: 1 });
      assert.isFalse(problems.some((q) => q.kind === 'blocking'));
    });
  });
});
