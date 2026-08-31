'use strict';

const crypto = require('crypto');
const path = require('path');

const ROOT_KEY_LENGTH = 16;
const ROOT_KEY_PATTERN = new RegExp(`^[a-f0-9]{${ROOT_KEY_LENGTH}}$`, 'i');

function normalizeRoot(root) {
  const resolved = path.resolve(String(root || ''));
  const portable = resolved.split(path.sep).join('/');
  return process.platform === 'win32' ? portable.toLowerCase() : portable;
}

function rootKey(root) {
  return crypto.createHash('sha256').update(normalizeRoot(root)).digest('hex').slice(0, ROOT_KEY_LENGTH);
}

function makeWallpaperId(root, externalId) {
  if (!root || typeof externalId !== 'string' || !externalId || /[\\/\0]/.test(externalId)) return null;
  return `${rootKey(root)}:${externalId}`;
}

function parseWallpaperId(id) {
  if (typeof id !== 'string' || !id || id.includes('\0')) return null;
  const separator = id.indexOf(':');
  if (separator < 0) {
    if (/[\\/]/.test(id)) return null;
    return { kind: 'legacy-bare', rootIndex: 0, externalId: id, canonicalId: null };
  }
  const prefix = id.slice(0, separator);
  const externalId = id.slice(separator + 1);
  if (!externalId || /[\\/\0]/.test(externalId)) return null;
  if (ROOT_KEY_PATTERN.test(prefix)) {
    return { kind: 'stable', rootKey: prefix.toLowerCase(), externalId, canonicalId: `${prefix.toLowerCase()}:${externalId}` };
  }
  if (/^\d+$/.test(prefix)) {
    const rootIndex = Number.parseInt(prefix, 10);
    if (!Number.isSafeInteger(rootIndex)) return null;
    return { kind: 'legacy-index', rootIndex, externalId, canonicalId: null };
  }
  return null;
}

module.exports = { ROOT_KEY_LENGTH, makeWallpaperId, normalizeRoot, parseWallpaperId, rootKey };
