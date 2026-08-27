'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasDshBootSignature, isDshRpcResponse } = require('../lib/dsh-probe.js');

test('DSH probe accepts the web boot signature', () => {
  assert.equal(hasDshBootSignature('<script>window.__DSH_BOOT__ = {};</script><title>DeepSeek Harness</title>'), true);
  assert.equal(hasDshBootSignature('<title>Some other local app</title>'), false);
});

test('DSH probe accepts only successful RPC envelopes', () => {
  assert.equal(isDshRpcResponse({ type: 'server-response', result: { ok: true, value: {} } }), true);
  assert.equal(isDshRpcResponse('{"type":"server-response","rpcId":"probe","result":{"ok":true,"value":{"items":'), true);
  assert.equal(isDshRpcResponse('{"type":"server-response","result":{"ok":false}}'), false);
  assert.equal(isDshRpcResponse('{"type":"other-response","result":{"ok":true}}'), false);
});
