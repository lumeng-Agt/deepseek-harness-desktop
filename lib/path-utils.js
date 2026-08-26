'use strict';

const path = require('path');

function isPathInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

function parseRange(header, total) {
  if (!Number.isSafeInteger(total) || total < 0 || typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || total === 0) return null;
    start = Math.max(total - suffixLength, 0);
    end = total - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, total - 1);
  }
  if (start < 0 || end < start || start >= total) return null;
  return { start, end, length: end - start + 1 };
}

function sanitizeFilename(name, fallback = 'unnamed') {
  const cleaned = String(name || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!cleaned) return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)) return `_${cleaned}`;
  return cleaned.slice(0, 180);
}

function portableRelative(relativePath) {
  return String(relativePath).split(path.sep).join('/');
}

module.exports = { isPathInside, parseRange, sanitizeFilename, portableRelative };
