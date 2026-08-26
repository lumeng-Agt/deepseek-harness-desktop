'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lz4Decompress, parsePkg } = require('../wallpaper-helper.js');

test('LZ4 decoder rejects malformed blocks', () => {
  assert.throws(() => lz4Decompress(Buffer.from([0xF0]), 16));
  assert.throws(() => lz4Decompress(Buffer.from([0x00, 0x00, 0x00]), 4));
});

test('LZ4 decoder decodes a literal-only final block', () => {
  const source = Buffer.from([0x50, 0x48, 0x65, 0x6C, 0x6C, 0x6F]);
  assert.deepEqual(lz4Decompress(source, 5), Buffer.from('Hello'));
});

test('PKGV parser rejects invalid entry bounds', () => {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(8, 0);
  header.write('PKGV0003', 4, 'ascii');
  header.writeUInt32LE(1, 12);
  header.writeUInt32LE(1, 16);
  assert.equal(parsePkg(header), null);
});
