'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isExpectedDshCommand } = require('../lib/process-utils.js');

test('process matcher accepts the DSH web command', () => {
  const bin = process.platform === 'win32' ? 'C:\\Users\\Alice\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js' : '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
  const command = process.platform === 'win32'
    ? `"C:\\Program Files\\nodejs\\node.exe" ${bin} web --host 127.0.0.1 --port 3080`
    : `node ${bin} web --host 127.0.0.1 --port 3080`;
  assert.equal(isExpectedDshCommand(command, bin), true);
  assert.equal(isExpectedDshCommand(command.replace(/ web /, ' cli '), bin), false);
});

test('process matcher rejects a different executable', () => {
  assert.equal(isExpectedDshCommand('node other.js web --port 3080', 'dsh/lib/bin.js'), false);
});
