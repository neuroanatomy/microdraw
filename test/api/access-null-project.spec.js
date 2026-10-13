'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const { AccessControlService, AccessLevel } = require('neuroweblab');
const U = require('../mocha.test.util');

// M6 (NWL 3eface3 → c2246d4): NWL's IsOwner catches a null project (786afcc).
// Before, every AccessControlService check threw a TypeError on a null or
// undefined project; now it answers false. microdraw's handlers check for a
// missing project before asking (404), so over HTTP the change shows only as
// "still no 500"; projects without an `owner` (production's HistoPath, A3)
// never threw and must still give nobody owner rights.

const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });

const ownerless = (shortname, anyoneAccess) => ({
  name: `M6 ${shortname}`,
  shortname,
  url: '',
  collaborators: {
    list: anyoneAccess ? [{ username: 'anyone', name: 'Any User', access: anyoneAccess }] : []
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }] },
  annotations: { list: [{ type: 'vectorial', name: 'm6 layer', values: '', display: true }] }
});

const checks = {
  canViewFiles: AccessControlService.canViewFiles,
  canEditFiles: AccessControlService.canEditFiles,
  canViewAnnotations: AccessControlService.canViewAnnotations,
  canEditAnnotations: AccessControlService.canEditAnnotations,
  canViewCollaborators: AccessControlService.canViewCollaborators,
  removeFiles: AccessControlService.hasFilesAccess(AccessLevel.REMOVE)
};

// NWL logs each failed specification (HasPublicAccess with its stack): keep
// the test output readable.
const quietly = (fn) => {
  const { error } = console;
  console.error = () => null;
  try {
    return fn();
  } finally {
    console.error = error;
  }
};

// eslint-disable-next-line max-statements
describe('A null project, a project without owner (M6, NWL IsOwner)', function () {
  describe('AccessControlService', function () {
    // what queryProject gives for a missing project (null), and a missing key
    const absent = {};
    for (const project of [null, absent.project]) {
      it(`answers false, without throwing, when the project is ${project}`, function () {
        for (const [name, check] of Object.entries(checks)) {
          for (const user of ['m6-user', 'anyone']) {
            let answer;
            try {
              answer = quietly(() => check(project, user));
            } catch (err) {
              assert.fail(`${name}(${project}, ${user}) threw ${err}`);
            }
            assert.isFalse(answer, `${name}(${project}, ${user})`);
          }
        }
      });
    }

    it('gives nobody owner rights on a project without owner', function () {
      const project = ownerless('m6unit', access('view', 'view', 'view'));
      for (const user of ['m6-user', 'anyone']) {
        assert.isTrue(quietly(() => checks.canViewFiles(project, user)), `${user} views (public)`);
        assert.isFalse(quietly(() => checks.canEditFiles(project, user)), `${user} edits files`);
        assert.isFalse(quietly(() => checks.canEditAnnotations(project, user)), `${user} edits annotations`);
        assert.isFalse(quietly(() => checks.removeFiles(project, user)), `${user} removes files`);
      }
    });
  });

  // eslint-disable-next-line max-statements
  describe('over HTTP', function () {
    const user = { username: 'm6-user', password: 'm6-user-password' };
    const publicView = ownerless('m6ownerlesspublic', access('view', 'view', 'view'));
    const noAnyone = ownerless('m6ownerlessprivate');
    const get = (requester, pathname) => requester.get(pathname).timeout(3000);
    // status of the project JSON, the project page and the annotations API
    const statuses = (requester, shortname) => Promise.all([
      `/project/json/${shortname}`,
      `/project/${shortname}`,
      `/api?project=${shortname}&source=/test_data/cat.json&slice=0`
    ].map((pathname) => get(requester, pathname)))
      .then((answers) => answers.map((res) => res.status));
    let agent;
    const requesters = () => [chai.request(U.serverURL), agent];

    before(async function () {
      // eslint-disable-next-line no-invalid-this -- mocha passes the hook context as this
      this.timeout(U.mediumTimeout);
      await U.insertProject({ ...publicView });
      await U.insertProject({ ...noAnyone });
      agent = await U.logIn(user);
    });

    after(async function () {
      await Promise.all([
        U.removeProject(publicView.shortname),
        U.removeProject(noAnyone.shortname),
        U.removeLocalUser(user.username)
      ]);
    });

    it('serves a public project without owner, to a visitor and to a logged-in user', async function () {
      const answers = await Promise.all(requesters().map((r) => statuses(r, publicView.shortname)));
      assert.deepEqual(answers, [[200, 200, 200], [200, 200, 200]]);
      const res = await get(agent, `/project/json/${publicView.shortname}`);
      assert.equal(res.body.shortname, publicView.shortname);
    }).timeout(U.shortTimeout);

    it('refuses (403, not 500) a project without owner and without \'anyone\'', async function () {
      const answers = await Promise.all(requesters().map((r) => statuses(r, noAnyone.shortname)));
      assert.deepEqual(answers, [[403, 403, 403], [403, 403, 403]]);
    }).timeout(U.shortTimeout);

    it('lets nobody edit the annotations of a project without owner', async function () {
      const answers = await Promise.all(requesters()
        .map((r) => get(r, `/api/permissions?project=${publicView.shortname}`)));
      for (const res of answers) {
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.annotations, { view: true, edit: false });
      }
    }).timeout(U.shortTimeout);

    it('answers 404 for a project that does not exist', async function () {
      let res = await get(chai.request(U.serverURL), '/project/json/m6doesnotexist');
      assert.equal(res.status, 404);
      res = await get(agent, '/api/permissions?project=m6doesnotexist');
      assert.equal(res.status, 404);
    }).timeout(U.shortTimeout);
  });
});
