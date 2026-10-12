/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert, expect } = chai;
const _ = require('lodash');
const U = require('../mocha.test.util');
const { plainText } = require('../../app/controller/project/project.validation');

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

const login = async (credentials) => {
  const agent = chai.request.agent(U.getServer());
  await agent.post('/localSignup').send(credentials);
  // /localSignup answers before its insert has finished.
  await U.delay(500);
  const res = await agent.post('/localLogin').redirects(0)
    .send(credentials);
  expect(res).to.have.cookie('connect.sid');

  return agent;
};

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

    it('a collaborator without a username or userID', async function () {
      const project = newProject('m3anoname');
      project.collaborators.list.push({ name: 'Nobody', access: { collaborators: 'none', annotations: 'view', files: 'view' } });
      await refused('m3anoname', project);
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
});
