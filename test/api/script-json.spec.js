'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');
const { scriptJSON, escapeHTML } = require('../../app/controller/escape');

// H2b: user-set names written into server-rendered pages. JSON in an inline
// <script> must not be able to close it, and HTML built as a string escapes
// its text. The browser check of the project page is in
// test/e2e/project-page.spec.js.
const SCRIPT_NAME = '</script><script>window.h2bInjected=true</script>';

// The value of `const <name>=…;` in a rendered page.
const inlineValue = (html, name) => {
  const match = html.match(new RegExp(`const ${name}=(.*);\\n`));
  assert.exists(match, `no inline ${name}`);

  return JSON.parse(match[1]);
};

describe('Escaping user-set names in pages (H2b)', function () {
  describe('scriptJSON and escapeHTML', function () {
    it('scriptJSON leaves no "<" or ">" and parses back to the same value', function () {
      const value = { name: SCRIPT_NAME, other: 'a & b \u2028 \u2029 \u003c' };
      const json = scriptJSON(value);
      assert.notMatch(json, /[<>]/);
      assert.deepEqual(JSON.parse(json), value);
    });

    it('escapeHTML escapes the five HTML special characters', function () {
      assert.equal(escapeHTML('<a href="x">\'&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });
  });

  describe('server-rendered pages', function () {
    const project = U.createProjectWithPermission('h2bscriptproject', {});
    project.collaborators.list[0].access.files = 'view';
    project.name = SCRIPT_NAME;
    project.annotations.list = [{ type: 'text', name: SCRIPT_NAME, values: null }];
    const user = { username: 'h2b-script-user', name: SCRIPT_NAME, joined: '2026-10-12T00:00:00.000Z' };

    before(async function () {
      await U.insertProject({ ...project });
      await U.insertUser({ ...user });
    });

    after(async function () {
      await U.removeProject(project.shortname);
      await U.removeLocalUser(user.username);
    });

    it('the project page keeps a "</script>" name inside its script', async function () {
      const res = await chai.request(U.serverURL).get(`/project/${project.shortname}`);
      assert.equal(res.status, 200);
      assert.notInclude(res.text, SCRIPT_NAME);
      const info = inlineValue(res.text, 'projectInfo');
      assert.equal(info.name, SCRIPT_NAME);
      assert.equal(info.annotations.list[0].name, SCRIPT_NAME);
    }).timeout(U.shortTimeout);

    it('the user page keeps a "</script>" name inside its script', async function () {
      const res = await chai.request(U.serverURL).get(`/user/${user.username}`);
      assert.equal(res.status, 200);
      assert.notInclude(res.text, SCRIPT_NAME);
      assert.equal(inlineValue(res.text, 'userInfo').name, SCRIPT_NAME);
    }).timeout(U.shortTimeout);
  });
});
