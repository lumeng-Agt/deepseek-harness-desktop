'use strict';

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part) : [];
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

function compareIdentifiers(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'number') return -1;
  if (typeof right === 'number') return 1;
  return String(left).localeCompare(String(right));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const result = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (result) return result;
  }
  return 0;
}

function checkMinimumVersion(actual, minimum) {
  const comparison = compareVersions(actual, minimum);
  if (comparison === null) return { compatible: null, reason: '版本号无法识别' };
  if (comparison < 0) return { compatible: false, reason: `需要 DSH >= ${minimum}` };
  return { compatible: true, reason: '' };
}

module.exports = { checkMinimumVersion, compareVersions, parseVersion };
