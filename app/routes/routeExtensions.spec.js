/* eslint-disable no-undef */
const assert = require('assert');
const http = require('http');
const chai = require('chai');
const nock = require('nock');
const {expect} = chai;

const express = require('express');
const app = express();
require('./routesExtensions')(app);

/**
 * Make an HTTP GET request compatible with nock interception.
 * @param {string} requestUrl The URL to fetch
 * @returns {Promise<{statusCode: number, body: string}>} The status code and body
 */
const httpGet = (requestUrl) => new Promise((resolve, reject) => {
  http.get(requestUrl, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString() }));
    res.on('error', reject);
  }).on('error', reject);
});

const nockMockUrl = 'http://nock-mock-url.me:3000';
const mockReplyJson1 = {
  key1 : 'value1',
  key2 : 'value2'
};
const mockReplyJson2 = {
  tileSources : [
    'http://test1.me/test1.dzi',
    'http://test2.me/test2.dzi'
  ]
};

const mockReplyJson2Augmented = {
  tileSources : [
    'http://test1.me/test1.dzi',
    'http://test2.me/test2.dzi'
  ]
};

const mockReplyJson3 = {
  tileSources : [
    '/test1.dzi',
    '/test2.dzi'
  ]
};

const mockReplyJson3Augmented = {
  tileSources : [
    `http://localhost:10002/getTile?source=${nockMockUrl}/test1.dzi`,
    `http://localhost:10002/getTile?source=${nockMockUrl}/test2.dzi`
  ]
};

const imageData = `random data here`;

const nockProxy = nock(nockMockUrl).persist();
nockProxy.get('/').reply(200);
nockProxy.get('/1.json').reply(200, mockReplyJson1);
nockProxy.get('/2.json').reply(200, mockReplyJson2);
nockProxy.get('/3.json').reply(200, mockReplyJson3);
nockProxy.get('/nonexistent.json').reply(400, mockReplyJson1);
nockProxy.get('/error.json').replyWithError({
  message: 'error message',
  code: 'error_code'
});

nockProxy.get('/test.jpg').reply(200, imageData);

describe('Mocha started', () => {
  it('now testing routeExtensions.spec', () => {
    assert.strictEqual(1, 1);
  });
});

describe('nock setup correctly', () => {
  it('fetches nock server correctly', async () => {
    const { statusCode } = await httpGet(nockMockUrl);
    expect(statusCode).to.be.equals(200);
  });
});

let _server;

describe('Test /getJson api end point', () => {

  before(() => {

    app.get('/', (_req, res) => res.status(200).send('ok'));
    _server = app.listen(10002, () => console.log('mocha test listening on port 10002'));
  });

  after(() => {
    _server.close();
  });

  it('fetches / correctly', async () => {
    const { statusCode, body } = await httpGet('http://localhost:10002/');
    expect(statusCode).to.be.equals(200);
    expect(body).to.equal('ok');
  });

  it('endpoint /getJson exists', async () => {
    const { statusCode } = await httpGet('http://localhost:10002/getJson');
    expect(statusCode).to.be.equal(404);
  });

  it('endpoint /getTile exists', async () => {
    const { statusCode } = await httpGet('http://localhost:10002/getTile');
    expect(statusCode).to.be.equal(404);
  });

  describe('endpoint /getJson fetches existing endpoint correctly', () => {

    it('error status code forwards the result onwards', async () => {
      const { statusCode } = await httpGet(`http://localhost:10002/getJson?source=${nockMockUrl}/nonexistent.json`);
      expect(statusCode).to.be.equal(404);
    });

    it('illformed json returns 404', async () => {
      const { statusCode } = await httpGet(`http://localhost:10002/getJson?source=${nockMockUrl}/1.json`);
      expect(statusCode).to.be.equal(404);
    });

    it('sometimes foreign server returns error (resp arg is undefined)', async () => {
      const { statusCode } = await httpGet(`http://localhost:10002/getJson?source=${nockMockUrl}/error.json`);
      expect(statusCode).to.be.equal(404);
    });

    describe('correctly formed json returns json with tileSources field correctly augmented', () => {
      it('http protocol tileSources augmented correctly', async () => {
        const { statusCode, body } = await httpGet(`http://localhost:10002/getJson?source=${nockMockUrl}/2.json`);
        expect(statusCode).to.be.equal(200);
        expect(JSON.parse(body)).to.be.deep.equal(mockReplyJson2Augmented);
      });

      it('absolute path protocol tileSources augmented correctly', async () => {
        const { statusCode, body } = await httpGet(`http://localhost:10002/getJson?source=${nockMockUrl}/3.json`);
        expect(statusCode).to.be.equal(200);
        expect(JSON.parse(body)).to.be.deep.equal(mockReplyJson3Augmented);
      });
    });
  });

  describe('endpoint /getTile pipes response correctly', () => {
    it('pipes requests correctly', async () => {
      const { statusCode, body } = await httpGet(`http://localhost:10002/getTile?source=${nockMockUrl}/test.jpg`);
      expect(statusCode).to.be.equal(200);
      expect(body).to.be.equal(imageData);
    });
  });
});
