'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { isPathInside, parseRange, sanitizeFilename } = require('../lib/path-utils.js');

test('path containment does not confuse sibling directories', () => {
  const root = path.join('C:', 'wallpapers');
  assert.equal(isPathInside(root, path.join(root, '123', 'preview.jpg')), true);
  assert.equal(isPathInside(root, path.join('C:', 'wallpapers-other', 'secret.txt')), false);
  assert.equal(isPathInside(root, path.join(root, '..', 'secret.txt')), false);
});

test('range parser handles normal, open and suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19, length: 10 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99, length: 10 });
  assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99, length: 5 });
  assert.equal(parseRange('bytes=100-101', 100), null);
  assert.equal(parseRange('bytes=abc', 100), null);
});

test('filename sanitizer prevents Windows device names and path separators', () => {
  assert.equal(sanitizeFilename('../CON.txt'), '.._CON.txt');
  assert.equal(sanitizeFilename('aux'), '_aux');
  assert.equal(sanitizeFilename('a:b?.png'), 'a_b_.png');
});
