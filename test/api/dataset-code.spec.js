/* eslint-disable no-template-curly-in-string -- the code under test, as text */
'use strict';

// A dataset is data from anywhere: nothing in it is run (page-helpers.js).
const { assert } = require('chai');
const fs = require('fs');
const path = require('path');
const { tileUrlFunction, parseJSONP, prepareTileSources } = require('../../app/public/js/page-helpers');

const MAC_BRAIN = path.join(__dirname, '../../app/public/MacBrainGallery/B61-AChE.json');

// eslint-disable-next-line max-statements
describe('tileUrlFunction: a getTileUrl string is read, not run', function () {
  it('a template string of its arguments, as MacBrainGallery has', function () {
    // eslint-disable-next-line no-sync
    const entries = JSON.parse(fs.readFileSync(MAC_BRAIN, 'utf8')).tileSources;
    assert.isAbove(entries.length, 0);
    for (const entry of entries) {
      const url = tileUrlFunction(entry.getTileUrl)(12, 3, 4);
      assert.match(url, /^https:\/\/macbraingallery\.yale\.edu\/slides2\/collection6\/B61-AChE\/\d+_files\/12\/3_4\.jpeg$/);
    }
  });

  it('quoted strings joined with +', function () {
    const get = tileUrlFunction('function getTileUrl(level, x, y) { return "http://a/b;c}/" + level + \'/\' + x + "_" + y + ".jpg"; }');
    assert.equal(get(9, 1, 2), 'http://a/b;c}/9/1_2.jpg');
  });

  it('text, then two arguments in a row, are joined as text, as in JavaScript', function () {
    assert.equal(tileUrlFunction('function(l, x, y) { return "t/" + l + x }')(1, 2, 3), 't/12');
    assert.equal(tileUrlFunction('function(l) { return `t/${ l }` }')(7), 't/7');
  });

  const refused = {
    'a call in a template': 'function(l,x,y){return `${alert(1)}`}',
    'a property in a template': 'function(l,x,y){return `${location.href}`}',
    'a name that is no argument': 'function(l,x,y){return "a" + document}',
    'a second statement': 'function(l,x,y){alert(1); return "a"}',
    'code before the function': '(alert(1), function(l,x,y){return "a"})',
    'code after the function': 'function(l,x,y){return "a"}; alert(1)',
    'a call after a string': 'function(l,x,y){return "a".concat(alert(1))}',
    'arithmetic': 'function(l,x,y){return "a" + (l - 8)}',
    'two arguments first, which JavaScript would add': 'function(l,x,y){return l + x + ".jpg"}',
    'a default value': 'function(l = alert(1),x,y){return "a"}',
    'an arrow function': '(l,x,y) => "a"',
    'a backslash': 'function(l,x,y){return "a\\"+alert(1)+\\""}',
    'something very long': `function(l,x,y){return "${'a'.repeat(5000)}"}`,
    'nothing': ''
  };
  for (const [what, code] of Object.entries(refused)) {
    it(`refuses ${what}`, function () {
      assert.throws(() => tileUrlFunction(code), /getTileUrl/);
    });
  }

  it('prepareTileSources gives the function, and leaves the list as it was', async function () {
    const entry = { width: 1, height: 1, getTileUrl: 'function(l,x,y){return "t/" + l}' };
    const [prepared] = await prepareTileSources([entry], () => Promise.resolve(), 'http://localhost/');
    assert.equal(prepared.getTileUrl(3), 't/3');
    assert.equal(prepared.width, 1);
    assert.isString(entry.getTileUrl);
  });

  it('prepareTileSources rejects a list with code', async function () {
    const err = await prepareTileSources([{ getTileUrl: 'alert(1)' }], () => Promise.resolve(), 'http://localhost/')
      .then(() => null, (e) => e);
    assert.match(err.message, /getTileUrl/);
  });
});

describe('parseJSONP: a .jsonp file is parsed, not run', function () {
  it('reads f(JSON), with or without a semicolon and a leading comment', function () {
    assert.deepEqual(parseJSONP('f({"a":[1]})'), { a: [1] });
    assert.deepEqual(parseJSONP('﻿/* list */\n f ( {"a":");"} ) ;\n'), { a: ');' });
  });

  for (const text of ['alert(1); f({})', 'f({}); alert(1)', 'f(alert(1))', 'g({})', 'f({a:1})', '{}', '']) {
    it(`refuses ${JSON.stringify(text)}`, function () {
      assert.throws(() => parseJSONP(text));
    });
  }
});
