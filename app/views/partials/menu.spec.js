/* eslint-disable no-undef */
/*
 * The top-right menu partial (menu.mustache), rendered by index and data:
 * a logged-in user gets a link to their page and "Log Out", a visitor gets
 * the login links. Run by npm run mocha (test/mocha.test.js).
 */
const http = require('http');
const { expect } = require('chai');
const express = require('express');
const mustacheExpress = require('mustache-express');

const app = express();
app.engine('mustache', mustacheExpress());
app.set('views', __dirname);
app.set('view engine', 'mustache');

const loginMethods = [
  { url: 'http://github.com', text: 'github' },
  { url: 'http://facebook.com', text: 'facebook' }
];

const views = {
  '/bobjane': { user: { username: 'bobjane' }, loginMethods },
  '/marydoe': { user: { username: 'marydoe' }, loginMethods },
  '/notLoggedIn': { loginMethods },
  '/nothingProvided': {}
};
Object.entries(views).forEach(([path, view]) => {
  app.get(path, (req, res) => res.render('menu', view));
});

const userLink = (username) => `<a href = "/user/${username}">${username}</a>`;
const logoutLink = '(<a href = "/logout">Log Out</a>)';
const loginLinks = ['<a href = "http://github.com">github</a>', '<a href = "http://facebook.com">facebook</a>'];

describe('menu partial', () => {
  let server;
  let base;

  const get = (path) => new Promise((resolve, reject) => {
    http.get(base + path, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    }).on('error', reject);
  });

  before((done) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

  ['bobjane', 'marydoe'].forEach((username) => {
    it(`shows ${username}'s page link and Log Out, no login links`, async () => {
      const { statusCode, body } = await get(`/${username}`);
      expect(statusCode).to.equal(200);
      expect(body).to.include(userLink(username));
      expect(body).to.include(logoutLink);
      loginLinks.forEach((link) => expect(body).to.not.include(link));
    });
  });

  it('shows the login links to a visitor, no user link and no Log Out', async () => {
    const { statusCode, body } = await get('/notLoggedIn');
    expect(statusCode).to.equal(200);
    expect(body).to.not.include('href = "/user/');
    expect(body).to.not.include(logoutLink);
    loginLinks.forEach((link) => expect(body).to.include(link));
  });

  it('renders with no data: no user link, no Log Out, no login links', async () => {
    const { statusCode, body } = await get('/nothingProvided');
    expect(statusCode).to.equal(200);
    expect(body).to.not.include('href = "/user/');
    expect(body).to.not.include(logoutLink);
    loginLinks.forEach((link) => expect(body).to.not.include(link));
  });
});
