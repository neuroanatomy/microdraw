/* eslint-disable max-lines */
'use strict';
/* eslint-disable max-statements -- one test per behaviour, with its checks */

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const _ = require('lodash');
const U = require('../mocha.test.util');

// T002 2.2: a collaborator row names its user by `username` (microdraw's key,
// all 264 production rows), `userID` (BrainBox's key, written by
// nwl-components next to `username` when a user is picked: 72 rows), or both.
// Every reader accepts a row with either key; every saved row gets both, equal.
const PREFIX = 'collabuserid';
const owner = { username: 'collab-userid-owner', password: 'collab-userid-owner-password' };
const byUsername = { username: 'collab-userid-uname', password: 'collab-userid-uname-password' };
const byUserID = { username: 'collab-userid-uid', password: 'collab-userid-uid-password' };
const byBoth = { username: 'collab-userid-both', password: 'collab-userid-both-password' };
const stranger = { username: 'collab-userid-stranger', password: 'collab-userid-stranger-password' };
const SOURCE = `/test_data/${PREFIX}.json`;

const none = { collaborators: 'none', annotations: 'none', files: 'none' };
const member = { collaborators: 'view', annotations: 'edit', files: 'view' };

// The three ways a stored row names a user
const rows = {
  [byUsername.username]: { username: byUsername.username, name: 'By username', access: member },
  [byUserID.username]: { userID: byUserID.username, name: 'By userID', access: member },
  [byBoth.username]: { username: byBoth.username, userID: byBoth.username, name: 'By both', access: member }
};

const project = (shortname, list = Object.values(rows)) => ({
  name: `T002 2.2 ${shortname}`,
  shortname,
  url: '',
  created: '2026-11-09T00:00:00.000Z',
  owner: owner.username,
  collaborators: { list: [{ username: 'anyone', name: 'Any User', access: none }, ...list] },
  files: { list: [{ source: SOURCE, name: 'cat' }] },
  annotations: { list: [{ type: 'text', name: 'Notes', values: null, display: true }] }
});

// The value of `const <name>=…;` in a rendered page.
const inlineValue = (html, name) => {
  const match = html.match(new RegExp(`const ${name}=(.*);\\n`));
  assert.exists(match, `no inline ${name}`);

  return JSON.parse(match[1]);
};

// The project as the settings page sends it back: the stored document
// without its _id
const asSent = (stored) => _.omit(stored, ['_id']);

describe('Collaborator rows named by username, userID or both (T002 2.2)', function () {
  const SHARED = `${PREFIX}shared`;
  const agents = {};

  const removeAll = async () => {
    const ours = { $regex: `^${PREFIX}` };
    await Promise.all([
      U.getDB().collection('projects')
        .deleteMany({ shortname: ours }),
      U.getDB().collection('annotations')
        .deleteMany({ project: ours }),
      U.getDB().collection('textAnnotations')
        .deleteMany({ project: ours })
    ]);
  };

  before(async function () {
    // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
    this.timeout(U.longTimeout);
    await removeAll();
    await U.insertProject(project(SHARED));
    for (const user of [owner, byUsername, byUserID, byBoth, stranger]) {
      // eslint-disable-next-line no-await-in-loop
      agents[user.username] = await U.logIn(user);
    }
  });

  after(async function () {
    await removeAll();
    await Promise.all([owner, byUsername, byUserID, byBoth, stranger].map((u) => U.removeLocalUser(u.username)));
  });

  for (const [user, key] of [[byUsername, 'username'], [byUserID, 'userID'], [byBoth, 'username and userID']]) {
    describe(`a row with ${key}`, function () {
      const agent = () => agents[user.username];

      it('gives access to the project page and the settings page', async function () {
        const page = await agent().get(`/project/${SHARED}`);
        assert.equal(page.status, 200);
        const settings = await agent().get(`/project/${SHARED}/settings`);
        assert.equal(settings.status, 200);
        assert.include(settings.text, 'const project=');
      }).timeout(U.shortTimeout);

      it('gives edit rights on the annotations (/api/permissions)', async function () {
        const res = await agent().get('/api/permissions')
          .query({ project: SHARED, source: SOURCE });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.annotations, { view: true, edit: true });
      }).timeout(U.shortTimeout);

      it('lets the user save annotations', async function () {
        const res = await agent().post('/api')
          .send({ action: 'save', project: SHARED, source: SOURCE, slice: 0, Hash: 'x', annotation: '[]' });
        assert.equal(res.status, 200, res.text);
      }).timeout(U.shortTimeout);

      it('lets the user write a text annotation', async function () {
        const res = await agent().post('/api/text-annotation')
          .send({ project: SHARED, source: SOURCE, layer: 'Notes', value: `by ${user.username}` });
        assert.equal(res.status, 200, res.text);
      }).timeout(U.shortTimeout);

      it('lists the project among the user\'s projects', async function () {
        const res = await agent().get(`/user/json/${user.username}/projects`);
        assert.equal(res.status, 200);
        assert.include(res.body.list.map((p) => p.shortname), SHARED);
      }).timeout(U.shortTimeout);

      it('finds the project in a search by the user', async function () {
        const res = await agent().get('/search/json/projects')
          .query({ q: PREFIX });
        assert.equal(res.status, 200);
        assert.include(res.body.map((p) => p.shortname), SHARED);
      }).timeout(U.shortTimeout);

      it('shows the row in the settings page, with both keys', async function () {
        const res = await agents[owner.username].get(`/project/${SHARED}/settings`);
        assert.equal(res.status, 200);
        const shown = inlineValue(res.text, 'project').collaborators.list.find((c) => c.username === user.username);
        assert.exists(shown, `no row for ${user.username} in the settings page`);
        assert.equal(shown.userID, user.username);
      }).timeout(U.shortTimeout);
    });
  }

  it('a user with no row gets none of that access', async function () {
    const agent = agents[stranger.username];
    assert.equal((await agent.get(`/project/${SHARED}`)).status, 403);
    const permissions = await agent.get('/api/permissions').query({ project: SHARED });
    assert.deepEqual(permissions.body.annotations, { view: false, edit: false });
    const listed = await agent.get(`/user/json/${stranger.username}/projects`);
    assert.notInclude(listed.body.list.map((p) => p.shortname), SHARED);
  }).timeout(U.shortTimeout);

  describe('settings saves (POST /project/json/:projectName)', function () {
    const post = (shortname, data) => agents[owner.username].post(`/project/json/${shortname}`)
      .send({ data });

    it('a save unchanged writes username and userID, equal, on every row (anyone included)', async function () {
      const shortname = `${PREFIX}saveall`;
      await U.insertProject(project(shortname));
      const res = await post(shortname, asSent(await U.queryProject(shortname)));
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.lengthOf(stored.collaborators.list, 4);
      for (const row of stored.collaborators.list) {
        assert.isString(row.username, JSON.stringify(row));
        assert.equal(row.userID, row.username, JSON.stringify(row));
      }
      assert.deepEqual(stored.collaborators.list.map((c) => c.username), ['anyone', byUsername.username, byUserID.username, byBoth.username]);
      // access unchanged
      assert.deepEqual(stored.collaborators.list.map((c) => c.access), [none, member, member, member]);
    }).timeout(U.shortTimeout);

    it('a stored row with username only saves unchanged apart from gaining userID (its user removed since)', async function () {
      const shortname = `${PREFIX}savegone`;
      const gone = { username: 'collab-userid-gone', name: 'Gone', access: member };
      await U.insertProject(project(shortname, [gone]));
      const res = await post(shortname, asSent(await U.queryProject(shortname)));
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.deepEqual(stored.collaborators.list[1], { ...gone, userID: gone.username });
    }).timeout(U.shortTimeout);

    it('a new row with userID only is stored with both keys', async function () {
      const shortname = `${PREFIX}savenewuid`;
      await U.insertProject(project(shortname, []));
      const data = asSent(await U.queryProject(shortname));
      data.collaborators.list.push({ userID: byUserID.username, access: member });
      const res = await post(shortname, data);
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.include(stored.collaborators.list[1], { username: byUserID.username, userID: byUserID.username });
    }).timeout(U.shortTimeout);

    it('a new project gets an anyone row with both keys', async function () {
      const shortname = `${PREFIX}savenew`;
      const data = asSent(project(shortname, []));
      delete data.owner;
      const res = await post(shortname, data);
      assert.equal(res.status, 200, res.text);
      const stored = await U.queryProject(shortname);
      assert.deepEqual(stored.collaborators.list, [{ username: 'anyone', userID: 'anyone', name: 'Any User', access: none }]);
    }).timeout(U.shortTimeout);

    it('the settings page of a new project shows an anyone row with both keys', async function () {
      const res = await agents[owner.username].get(`/project/${PREFIX}notyet/settings`);
      assert.equal(res.status, 200);
      const [anyone] = inlineValue(res.text, 'project').collaborators.list;
      assert.include(anyone, { username: 'anyone', userID: 'anyone' });
    }).timeout(U.shortTimeout);

    it('a new row whose username and userID differ is refused (400)', async function () {
      const shortname = `${PREFIX}savediffnew`;
      await U.insertProject(project(shortname, []));
      const data = asSent(await U.queryProject(shortname));
      data.collaborators.list.push({ username: byUsername.username, userID: byUserID.username, access: member });
      const res = await post(shortname, data);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /different username .* and userID/);
      assert.lengthOf((await U.queryProject(shortname)).collaborators.list, 1);
    }).timeout(U.shortTimeout);

    it('a stored row whose username and userID differ is refused (400), naming both', async function () {
      const shortname = `${PREFIX}savediffstored`;
      await U.insertProject(project(shortname, [{ username: byUsername.username, userID: byUserID.username, access: member }]));
      const res = await post(shortname, asSent(await U.queryProject(shortname)));
      assert.equal(res.status, 400);
      assert.include(res.body.message, byUsername.username);
      assert.include(res.body.message, byUserID.username);
      assert.notProperty((await U.queryProject(shortname)).collaborators.list[0], 'userID');
    }).timeout(U.shortTimeout);

    it('a new row with userID only must name an existing user', async function () {
      const shortname = `${PREFIX}saveunknown`;
      await U.insertProject(project(shortname, []));
      const data = asSent(await U.queryProject(shortname));
      data.collaborators.list.push({ userID: 'collab-userid-nobody', access: member });
      const res = await post(shortname, data);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Unknown users: collab-userid-nobody/);
    }).timeout(U.shortTimeout);
  });
});
