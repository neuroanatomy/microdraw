'use strict';

const chai = require('chai');
const { assert } = chai;
const U = require('../mocha.test.util');
const { ensureIndexes, ANNOTATIONS_PROJECT_INDEX } = require('../../app/controller/indexes');
const { newestAnnotationsPipeline } = require('../../app/controller/user/lastModified');

// The user page's "Last modified" reads the newest annotation of each listed
// project with one aggregation (user/lastModified.js newestAnnotations). The app
// creates {project: 1, _id: -1} on `annotations` at startup so that it does
// not scan the whole collection (209,660 documents on production).
const indexNamed = async (name) => (await U.getNativeDB().collection('annotations')
  .indexInformation())[name];

describe('Index on annotations for the user page (project, _id)', function () {
  it('exists after startup', async function () {
    assert.deepEqual(await indexNamed(ANNOTATIONS_PROJECT_INDEX), [['project', 1], ['_id', -1]]);
  }).timeout(U.shortTimeout);

  it('is created again without error when it exists already', async function () {
    await ensureIndexes(U.getNativeDB());
    assert.deepEqual(await indexNamed(ANNOTATIONS_PROJECT_INDEX), [['project', 1], ['_id', -1]]);
  }).timeout(U.shortTimeout);

  it('does not throw when an index on the same keys has another name', async function () {
    const annotations = U.getNativeDB().collection('annotations');
    await annotations.dropIndex(ANNOTATIONS_PROJECT_INDEX);
    await annotations.createIndex({ project: 1, _id: -1 }, { name: 'other-name' });
    try {
      await ensureIndexes(U.getNativeDB());
    } finally {
      await annotations.dropIndex('other-name');
      await ensureIndexes(U.getNativeDB());
    }
    assert.deepEqual(await indexNamed(ANNOTATIONS_PROJECT_INDEX), [['project', 1], ['_id', -1]]);
  }).timeout(U.shortTimeout);

  it('is used by the newest-annotation aggregation (IXSCAN, not COLLSCAN)', async function () {
    const explain = await U.getNativeDB().collection('annotations')
      .aggregate(newestAnnotationsPipeline(['apiindexa', 'apiindexb']))
      .explain();
    const plan = JSON.stringify(explain);
    assert.include(plan, 'IXSCAN');
    assert.include(plan, ANNOTATIONS_PROJECT_INDEX);
    assert.notInclude(plan, 'COLLSCAN');
  }).timeout(U.shortTimeout);
});
