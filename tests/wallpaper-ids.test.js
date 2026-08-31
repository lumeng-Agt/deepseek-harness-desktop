'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeWallpaperId, parseWallpaperId, rootKey } = require('../lib/wallpaper-ids.js');

test('wallpaper IDs remain stable when root order changes', () => {
  const root = path.join('C:', 'SteamLibrary', 'steamapps', 'workshop', 'content', '431960');
  const id = makeWallpaperId(root, '123456');
  assert.equal(id, `${rootKey(root)}:123456`);
  assert.deepEqual(parseWallpaperId(id), { kind: 'stable', rootKey: rootKey(root), externalId: '123456', canonicalId: id });
});

test('wallpaper IDs accept legacy index and bare settings for migration', () => {
  assert.deepEqual(parseWallpaperId('0:123456'), { kind: 'legacy-index', rootIndex: 0, externalId: '123456', canonicalId: null });
  assert.deepEqual(parseWallpaperId('123456'), { kind: 'legacy-bare', rootIndex: 0, externalId: '123456', canonicalId: null });
  assert.equal(parseWallpaperId('0:../secret'), null);
  assert.equal(parseWallpaperId('not-a-root:123456'), null);
});
