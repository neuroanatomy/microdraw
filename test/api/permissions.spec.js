'use strict';

const chai = require('chai');
var {assert, expect} = chai;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const U = require('../mocha.test.util');
const _ = require('lodash');

// The other permission checks of this file (refusals, edit/add/remove on each
// list, hidden collaborators) are in NeuroWebLab's shared suite, slices 1
// and 2 (test/api/conformance.spec.js). These two remove a row as a
// collaborator with `remove` on that list, which the suite does as the owner.
describe('TESTING PERMISSIONS (HTTP)', function () {
  let agent;
  let token = '';

  before(async () => {
    agent = chai.request.agent(U.getServer());
    // 200 once the user is stored (NWL 0.2.0); 409 if it exists already
    await U.signUp(U.testingCredentials);
    let res = await agent.post('/localLogin').redirects(0)
      .send(U.testingCredentials);
    expect(res).to.have.cookie('connect.sid');

    res = await agent.get('/token');
    assert.exists(res.body.token);
    assert.isNotEmpty(res.body.token);
    ({token} = res.body);
  });

  after(async function () {
    await U.removeLocalUser(U.testingCredentials.username);
  });

  const post = function(url) {
    return agent.post(`${url}?token=${token}`);
  };

  describe('Test remove permissions of logged users', function() {

    const projects = {};
    const setupProjectWithAccess = (access, name) => {
      const project = U.createProjectWithPermission(name, access);
      projects[project.name] = project;

      return U.insertProject(project);
    };

    before(async function () {
      await Promise.all([
        setupProjectWithAccess({ files: 'remove' }, 'filesremove'),
        setupProjectWithAccess({ files: 'edit', collaborators: 'remove' }, 'collaboratorsremovefilesedit')
      ]);
    });

    after(async function() {
      await Promise.all(Object.keys(projects).map((shortname) => U.removeProject(shortname)));
    });

    it('Checks that collaborators can remove project collaborators if set to remove', async function() {
      const project = _.cloneDeep(projects.collaboratorsremovefilesedit);
      const initialProjectState = _.cloneDeep(project);
      project.collaborators.list.splice(1, 1);

      const res = await post('/project/json/' + project.shortname)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const projectFromDB = await U.queryProject(project.shortname);
      assert.isBelow(projectFromDB.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    it('Checks that collaborators can remove project files if set to remove', async function() {
      const project = _.cloneDeep(projects.filesremove);
      const initialProjectState = _.cloneDeep(project);
      project.files.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const projectFromDB = await U.queryProject(project.shortname);
      assert.isBelow(projectFromDB.files.list.length, initialProjectState.files.list.length);
    });
  });
});
