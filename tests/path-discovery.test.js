'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../path-discovery.js');

test('wallpaper discovery honors an explicit directory after cache reset', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wallpaper-'));
  const previous = process.env.DSHGUI_WALLPAPER_DIR;
  process.env.DSHGUI_WALLPAPER_DIR = directory;
  discovery.resetSteamRootsCache();
  assert.equal(discovery.findWallpaperDirs('431960').includes(path.resolve(directory)), true);
  if (previous === undefined) delete process.env.DSHGUI_WALLPAPER_DIR;
  else process.env.DSHGUI_WALLPAPER_DIR = previous;
  discovery.resetSteamRootsCache();
  fs.rmSync(directory, { recursive: true, force: true });
});
