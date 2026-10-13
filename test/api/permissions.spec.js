/* eslint-disable max-lines */
'use strict';

const chai = require('chai');
var {assert, expect} = chai;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const U = require('../mocha.test.util');
const _ = require('lodash');

// eslint-disable-next-line max-statements
describe('TESTING PERMISSIONS (HTTP)', function () {
  let agent;
  let token = '';

  // eslint-disable-next-line max-statements
  before(async () => {
    agent = chai.request.agent(U.getServer());
    await U.insertProject(U.privateProjectTest);
    // the collaborator the tests add: since M3 a project only names users that exist
    await U.insertUser({ username: 'foo', name: 'Foo' });
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
    await U.removeProject(U.privateProjectTest.shortname);
    await U.removeLocalUser(U.testingCredentials.username);
    await U.removeLocalUser('foo');
  });

  const get = function(url, logged) {
    if (logged) {
      return agent.get(url).query({ token });
    }

    return chai.request(U.serverURL).get(url);
  };

  const post = function(url, logged) {
    if (logged) {
      return agent.post(`${url}?token=${token}`);
    }

    return chai.request(U.serverURL).post(url);
  };

  const del = function(url, logged) {
    if (logged) {
      return agent.del(url).query({ token });
    }

    return chai.request(U.serverURL).del(url);
  };

  const forbiddenStatusCodes = [403, 401];

  describe('Test basic unprivileged access', function() {

    ['unlogged', 'logged'].forEach((userStatus) => {

      const logged = userStatus === 'logged';

      it(`Disallows accessing a private project (${userStatus})`, async function () {
        const res = await get('/project/' + U.privateProjectTest.shortname, logged);
        assert.oneOf(res.statusCode, forbiddenStatusCodes);
      });

      it(`Disallows accessing a private project settings (${userStatus})`, async function () {
        const res = await get('/project/' + U.privateProjectTest.shortname + '/settings', logged);
        assert.oneOf(res.statusCode, forbiddenStatusCodes);
      });

      it(`Disallows accessing a private project using JSON api (${userStatus})`, async function () {
        const res = await get('/project/json/' + U.privateProjectTest.shortname, logged);
        assert.oneOf(res.statusCode, forbiddenStatusCodes);
      });

      it(`Disallows updating a private project (${userStatus})`, async function () {
        const res = await post('/project/json/' + U.privateProjectTest.shortname, logged)
          .send({data: U.privateProjectTest});
        assert.oneOf(res.statusCode, forbiddenStatusCodes);
      });

      it(`Disallows deleting a private project (${userStatus})`, async function () {
        const res = await del('/project/json/' + U.privateProjectTest.shortname, logged);
        assert.oneOf(res.statusCode, forbiddenStatusCodes);
      });
    });
  });

  // eslint-disable-next-line max-statements
  describe('Test specific edit / add / remove permissions of logged users', function() {

    const projects = {};
    const setupProjectWithAccess = (access, name) => {
      const project = U.createProjectWithPermission(name, access);
      projects[project.name] = project;

      return U.insertProject(project);
    };

    before(async function () {
      const inserts = [];
      ["none", "view", "edit", "add", "remove"].forEach((access) => {
        inserts.push(setupProjectWithAccess(
          { files: access },
          `files${access}`
        ));
        inserts.push(setupProjectWithAccess(
          { files: 'edit', collaborators: access },
          `collaborators${access}filesedit`
        ));
        inserts.push(setupProjectWithAccess(
          { files: 'edit', annotations: access },
          `fileseditannotations${access}`
        ));
      });
      await Promise.all(inserts);
    });

    after(async function() {
      await Promise.all(Object.keys(projects).map((shortname) => U.removeProject(shortname)));
    });

    it('Checks that collaborators cannot edit a project if files is set to none', async function() {
      const project = _.cloneDeep(projects.filesnone);
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.oneOf(res.statusCode, forbiddenStatusCodes);
    });

    it('Checks that collaborators cannot remove a project if files  is set to none', async function() {
      const project = _.cloneDeep(projects.filesnone);
      const res = await del('/project/json/' + project.shortname, true);
      assert.oneOf(res.statusCode, forbiddenStatusCodes);
    });

    it('Checks that collaborators can edit a project if files is set to add', async function() {
      const project = _.cloneDeep(projects.filesadd);
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
    });

    it('Checks that collaborators can edit a project if files is set to edit', async function() {
      const project = _.cloneDeep(projects.filesedit);
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
    });

    it('Checks that collaborators can edit a project if files is set to remove', async function() {
      const project = _.cloneDeep(projects.filesremove);
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
    });

    // eslint-disable-next-line max-statements
    it('Checks that collaborators cannot add project collaborators if set to none or view', async function() {
      let project = _.cloneDeep(projects.collaboratorsnonefilesedit);
      let initialProjectState = _.cloneDeep(project);
      project.collaborators.list.push({
        userID: "foo",
        access: {
          collaborators: "edit",
          annotations: "edit",
          files: "edit"
        },
        username: "foo",
        name: "Foo"
      });

      let res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      let fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);

      project = _.cloneDeep(projects.collaboratorsviewfilesedit);
      initialProjectState = _.cloneDeep(project);
      project.collaborators.list.push({
        userID: "foo",
        access: {
          collaborators: "edit",
          annotations: "edit",
          files: "edit"
        },
        username: "foo",
        name: "Foo"
      });
      res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);

    });

    it('Checks that collaborators cannot remove project collaborators if set to none', async function() {
      const project = _.cloneDeep(projects.collaboratorsnonefilesedit);
      const initialProjectState = _.cloneDeep(project);
      project.collaborators.list.splice(1, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    it('Checks that collaborators cannot remove project collaborators if set to view', async function() {
      const project = _.cloneDeep(projects.collaboratorsviewfilesedit);
      const initialProjectState = _.cloneDeep(project);
      project.collaborators.list.splice(1, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    it('Checks that collaborators cannot remove project collaborators if set to add', async function() {
      const project = _.cloneDeep(projects.collaboratorsaddfilesedit);
      const initialProjectState = _.cloneDeep(project);
      project.collaborators.list.splice(1, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    // eslint-disable-next-line max-statements
    it('Checks that collaborators can add project collaborators if set to add or remove', async function() {
      let project = projects.collaboratorsaddfilesedit;
      let initialProjectState = _.cloneDeep(project);
      project.collaborators.list.push({
        userID: "foo",
        access: {
          collaborators: "edit",
          annotations: "edit",
          files: "edit"
        },
        username: "foo",
        name: "Foo"
      });

      let res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      // check that collaborators got modified
      let projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.collaborators.list.length, initialProjectState.collaborators.list.length);

      project = projects.collaboratorsremovefilesedit;
      initialProjectState = _.cloneDeep(project);
      project.collaborators.list.push({
        userID: "foo",
        access: {
          collaborators: "edit",
          annotations: "edit",
          files: "edit"
        },
        username: "foo",
        name: "Foo"
      });
      res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    it('Checks that collaborators can remove project collaborators if set to remove', async function() {
      const project = _.cloneDeep(projects.collaboratorsremovefilesedit);
      const initialProjectState = _.cloneDeep(project);
      project.collaborators.list.splice(1, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const projectFromDB = await U.queryProject(project.shortname);
      assert.isBelow(projectFromDB.collaborators.list.length, initialProjectState.collaborators.list.length);
    });


    // Wrong field, left for M1 (catch-up plan): this asserts collaborators.list, not annotations.list, so it does not test what its name says.
    it('Checks that collaborators cannot add project annotations if set to none', async function() {
      const project = _.cloneDeep(projects.fileseditannotationsnone);
      const initialProjectState = _.cloneDeep(project);
      project.annotations.list.push({
        type: "text",
        name: "Annotation name",
        values: null
      });
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    // Wrong field, left for M1 (catch-up plan): this asserts collaborators.list, not annotations.list, so it does not test what its name says.
    it('Checks that collaborators cannot add project annotations if set to view', async function() {
      const project = _.cloneDeep(projects.fileseditannotationsview);
      const initialProjectState = _.cloneDeep(project);
      project.annotations.list.push({
        type: "text",
        name: "Annotation name",
        values: null
      });
      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    // eslint-disable-next-line max-statements
    it('Checks that collaborators can add project annotations if set to add or remove', async function() {
      let project = projects.fileseditannotationsadd;
      let initialProjectState = _.cloneDeep(project);
      project.annotations.list.push({
        type: "text",
        name: "Annotation name",
        values: null
      });
      let res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      let projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.annotations.list.length, initialProjectState.annotations.list.length);

      project = projects.fileseditannotationsremove;
      initialProjectState = _.cloneDeep(project);
      project.annotations.list.push({
        type: "text",
        name: "Annotation name",
        values: null
      });
      res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.annotations.list.length, initialProjectState.annotations.list.length);
    });

    // Wrong field, left for M1 (catch-up plan): this asserts collaborators.list, not annotations.list, so it does not test what its name says.
    it('Checks that collaborators cannot remove project annotations if set to none', async function() {
      const project = _.cloneDeep(projects.fileseditannotationsnone);
      const initialProjectState = _.cloneDeep(project);
      project.annotations.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    // Wrong field, left for M1 (catch-up plan): this asserts collaborators.list, not annotations.list, so it does not test what its name says.
    it('Checks that collaborators cannot remove project annotations if set to view', async function() {
      const project = _.cloneDeep(projects.fileseditannotationsview);
      const initialProjectState = _.cloneDeep(project);
      project.annotations.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });

    // Wrong field, left for M1 (catch-up plan): this asserts collaborators.list, not annotations.list, so it does not test what its name says.
    it('Checks that collaborators cannot remove project annotations if set to add', async function() {
      const project = _.cloneDeep(projects.fileseditannotationsadd);
      const initialProjectState = _.cloneDeep(project);
      project.annotations.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const fromDb = await U.queryProject(project.shortname);
      assert.equal(fromDb.collaborators.list.length, initialProjectState.collaborators.list.length);
    });


    it('Checks that collaborators cannot add project files if set to none or view', async function() {
      let project = _.cloneDeep(projects.filesnone);
      project.files.list.push({source: "https://zenodo.org/record/44855/files/MRI-n4.nii.gz", name: "MRI-n4.nii.gz"});
      let res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.oneOf(res.statusCode, forbiddenStatusCodes);

      project = _.cloneDeep(projects.filesview);
      project.files.list.push({source: "https://zenodo.org/record/44855/files/MRI-n4.nii.gz", name: "MRI-n4.nii.gz"});
      res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.oneOf(res.statusCode, forbiddenStatusCodes);
    });

    // eslint-disable-next-line max-statements
    it('Checks that collaborators can add project files if set to add or remove', async function() {
      let project = _.cloneDeep(projects.filesadd);
      let initialProjectState = _.cloneDeep(project);
      project.files.list.push({source: "https://zenodo.org/record/44855/files/MRI-n4.nii.gz", name: "MRI-n4.nii.gz"});
      let res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      let projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.files.list.length, initialProjectState.files.list.length);

      project = _.cloneDeep(projects.filesremove);
      initialProjectState = _.cloneDeep(project);
      project.files.list.push({source: "https://zenodo.org/record/44855/files/MRI-n4.nii.gz", name: "MRI-n4.nii.gz"});
      res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      projectFromDB = await U.queryProject(project.shortname);
      assert.isAbove(projectFromDB.files.list.length, initialProjectState.files.list.length);
    });

    it('Checks that collaborators cannot remove project files if set to none', async function() {
      const project = _.cloneDeep(projects.filesnone);
      project.files.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.oneOf(res.statusCode, forbiddenStatusCodes);
    });

    it('Checks that collaborators cannot remove project files if set to view', async function() {
      const project = _.cloneDeep(projects.filesview);
      project.files.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.oneOf(res.statusCode, forbiddenStatusCodes);
    });

    it('Checks that collaborators cannot remove project files if set to add', async function() {
      let project = U.createProjectWithPermission('permissionTest', { files: 'add' });
      projects.permissionTest = project;
      await U.insertProject(project);

      const initialProjectState = _.cloneDeep(project);
      project = _.cloneDeep(project);
      project.files.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const projectFromDB = await U.queryProject(project.shortname);
      assert.equal(projectFromDB.files.list.length, initialProjectState.files.list.length);
    });

    it('Checks that collaborators can remove project files if set to remove', async function() {
      const project = _.cloneDeep(projects.filesremove);
      const initialProjectState = _.cloneDeep(project);
      project.files.list.splice(0, 1);

      const res = await post('/project/json/' + project.shortname, true)
        .send({data: project});
      assert.equal(res.statusCode, 200);
      const projectFromDB = await U.queryProject(project.shortname);
      assert.isBelow(projectFromDB.files.list.length, initialProjectState.files.list.length);
    });

    describe('Test view permissions of logged users', function() {
      // The two browser checks of the settings page stay in test/e2e/permissions.spec.js.

      it('Check that collaborators cannot see other collaborators if not permitted using JSON API', async function () {
        const project = _.cloneDeep(projects.collaboratorsnonefilesedit);
        const res = await get('/project/json/' + project.shortname, true);
        assert.equal(res.body.collaborators.list.length, 1);
      });
    });

  });


});
