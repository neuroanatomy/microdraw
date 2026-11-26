'use strict';

const { assert } = require('chai');
const { fetchJSON, loadScript } = require('../../app/public/js/page-helpers');

// The pages' one loadScript and one fetchJSON (T002 C2, W10). No server, no
// browser: fetch and document are stand-ins.
describe('Page helpers (T002 C2)', function () {
  const saved = {};
  beforeEach(function () {
    saved.fetch = global.fetch;
    saved.document = global.document;
  });
  afterEach(function () {
    global.fetch = saved.fetch;
    if (typeof saved.document === 'undefined') {
      delete global.document;
    } else {
      global.document = saved.document;
    }
  });

  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

  it('fetchJSON: passes the options, answers the parsed JSON, whatever its success key', async function () {
    const calls = [];
    global.fetch = (url, init) => {
      calls.push([url, init]);

      return Promise.resolve(answer(200, { success: false, names: ['a'] }));
    };
    const init = { headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    assert.deepEqual(await fetchJSON('/x.json', init), { success: false, names: ['a'] });
    assert.deepEqual(calls, [['/x.json', init]]);
  });

  it('fetchJSON: an error status rejects, with the status', async function () {
    global.fetch = () => Promise.resolve(answer(404, { error: 'not found' }));
    const err = await fetchJSON('/missing.json').then(() => null, (e) => e);
    assert.instanceOf(err, Error);
    assert.equal(err.status, 404);
    assert.equal(err.message, '/missing.json answered 404');
  });

  const fakeDocument = () => {
    const added = [];
    global.document = {
      createElement: (tag) => ({ tag }),
      body: { appendChild: (el) => added.push(el) }
    };

    return added;
  };

  it('loadScript: adds one script and resolves once it has loaded', async function () {
    const added = fakeDocument();
    const loading = loadScript('/js/a.js');
    assert.lengthOf(added, 1);
    assert.include(added[0], { tag: 'script', src: '/js/a.js' });
    added[0].onload();
    assert.isUndefined(await loading);
  });

  it('loadScript: rejects when the script cannot be loaded', async function () {
    const added = fakeDocument();
    const loading = loadScript('/js/b.js');
    added[0].onerror();
    const err = await loading.then(() => null, (e) => e);
    assert.equal(err.message, 'cannot load /js/b.js');
  });
});
