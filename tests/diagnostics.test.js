'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { atomicWriteFile } = require('../lib/atomic-file.js');
const { createRedactingLogStream, redactDiagnostic } = require('../lib/diagnostics.js');

test('diagnostics redact paths and common credential formats', () => {
  const result = redactDiagnostic('C:\\Users\\Alice\\project Bearer abc123 token=secret api_key: "hidden"', 'C:\\Users\\Alice');
  assert.equal(result.includes('abc123'), false);
  assert.equal(result.includes('secret'), false);
  assert.equal(result.includes('hidden'), false);
  assert.equal(result.includes('%USERPROFILE%'), true);
});

test('child-process log stream redacts split lines', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-'));
  const file = path.join(directory, 'dsh.log');
  const stream = createRedactingLogStream(file);
  stream.write('Bearer split-');
  stream.end('secret\nnormal line');
  await once(stream, 'finish');
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content.includes('split-secret'), false);
  assert.equal(content.includes('<redacted>'), true);
  assert.equal(content.includes('normal line'), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('atomic writes replace existing files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-atomic-'));
  const file = path.join(directory, 'settings.json');
  assert.equal(atomicWriteFile(file, 'first', { encoding: 'utf8' }), true);
  assert.equal(atomicWriteFile(file, 'second', { encoding: 'utf8' }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  fs.rmSync(directory, { recursive: true, force: true });
});
