'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RecoveryGate } = require('../lib/recovery.js');

test('recovery gate prevents duplicate attempts and cools down failures', () => {
  const gate = new RecoveryGate(1000);
  assert.equal(gate.tryStart(100), true);
  assert.equal(gate.tryStart(100), false);
  gate.finish(false, 200);
  assert.equal(gate.canStart(1199), false);
  assert.equal(gate.tryStart(1200), true);
  gate.finish(true, 1300);
  assert.equal(gate.tryStart(1300), true);
});
