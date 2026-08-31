'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMinimumVersion, compareVersions, parseVersion } = require('../lib/version-utils.js');

test('version parser compares stable and prerelease DSH versions', () => {
  assert.deepEqual(parseVersion('v0.1.0-rc.6'), { major: 0, minor: 1, patch: 0, prerelease: ['rc', 6] });
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.6'), 0);
  assert.equal(compareVersions('0.1.0', '0.1.0-rc.6') > 0, true);
  assert.equal(compareVersions('0.1.0-rc.5', '0.1.0-rc.6') < 0, true);
});

test('minimum version check reports unknown versions without blocking them', () => {
  assert.deepEqual(checkMinimumVersion('0.1.0-rc.5', '0.1.0-rc.6'), { compatible: false, reason: '需要 DSH >= 0.1.0-rc.6' });
  assert.deepEqual(checkMinimumVersion('0.1.0-rc.6', '0.1.0-rc.6'), { compatible: true, reason: '' });
  assert.equal(checkMinimumVersion('development-build', '0.1.0-rc.6').compatible, null);
});
