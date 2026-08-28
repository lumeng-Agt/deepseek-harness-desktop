'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform } = require('stream');

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LOG_LINE_CHARS = 64 * 1024;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactDiagnostic(message, home = os.homedir()) {
  let text = String(message ?? '');
  const userHome = path.resolve(home || '');
  if (userHome.length > 2) text = text.replace(new RegExp(escapeRegExp(userHome), 'gi'), '%USERPROFILE%');
  return text
    .replace(/(Bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|password)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|access[_-]?token|token|password)\s*[:=]\s*)(["']?)[^\s&,}"']+\2/gi, '$1$2<redacted>$2');
}

function rotateLog(file, maxBytes = DEFAULT_MAX_LOG_BYTES) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size <= maxBytes) return;
    const rotated = `${file}.1`;
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(file, rotated);
  } catch (error) {}
}

function appendLog(file, message, maxBytes = DEFAULT_MAX_LOG_BYTES) {
  try {
    rotateLog(file, maxBytes);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${redactDiagnostic(message)}\n`, { encoding: 'utf8' });
  } catch (error) {}
}

function createRedactingLogStream(file, maxBytes = DEFAULT_MAX_LOG_BYTES) {
  let pending = '';
  const writeLine = (line) => appendLog(file, line, maxBytes);
  return new Transform({
    transform(chunk, encoding, callback) {
      pending += Buffer.from(chunk, encoding).toString('utf8');
      while (true) {
        const newline = pending.search(/[\r\n]/);
        if (newline < 0) break;
        writeLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1).replace(/^\n/, '');
      }
      if (pending.length > MAX_LOG_LINE_CHARS) {
        writeLine(`${pending.slice(0, MAX_LOG_LINE_CHARS)} [line truncated]`);
        pending = '';
      }
      callback();
    },
    flush(callback) {
      if (pending) writeLine(pending);
      callback();
    }
  });
}

module.exports = { appendLog, createRedactingLogStream, redactDiagnostic, rotateLog };
