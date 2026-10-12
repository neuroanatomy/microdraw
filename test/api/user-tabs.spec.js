'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { assert } = chai;
const U = require('../mocha.test.util');

// M2: the user page's Datasets and Atlas tabs are hidden until stage 3 (3.3,
// 3.4) implements them. Their routes answer an empty list instead of the
// hard-coded fake rows they used to send.
const username = 'api-user-tabs-anybody';
const get = (pathname) => chai.request(U.serverURL).get(pathname);

describe('User page Datasets and Atlas routes (M2)', function () {
  before(async function () {
    await U.insertUser({ username, name: username, joined: new Date() });
  });

  after(async function () {
    await U.removeLocalUser(username);
  });

  it('GET /user/json/:userName/files answers an empty list', async function () {
    const res = await get(`/user/json/${username}/files`);
    assert.equal(res.status, 200);
    assert.isTrue(res.body.success);
    assert.deepEqual(res.body.list, []);
  }).timeout(U.shortTimeout);

  it('GET /user/json/:userName/atlas answers an empty list', async function () {
    const res = await get(`/user/json/${username}/atlas`);
    assert.equal(res.status, 200);
    assert.isTrue(res.body.successful);
    assert.deepEqual(res.body.list, []);
  }).timeout(U.shortTimeout);

  // The tabs are rendered in the browser from the page's inline template.
  it('the user page template has a Projects tab and no Datasets or Atlas tab', async function () {
    const res = await get(`/user/${username}`);
    assert.equal(res.status, 200);
    const tabs = [...res.text.matchAll(/<Tab title="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ['Projects']);
  }).timeout(U.shortTimeout);
});
