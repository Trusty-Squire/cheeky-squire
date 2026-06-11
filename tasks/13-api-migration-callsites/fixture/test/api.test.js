const test = require('node:test');
const assert = require('node:assert');
const api = require('../src/index.js');

// These assertions expect the MIGRATED logging API: log(level, message)
// formatting as `[${LEVEL}] ${message}`. With the unmigrated fixture the
// baseline emits `[LOG] ...` from single-arg call sites, so this suite FAILS
// until all call sites pass an explicit 'info' level.
test('feature outputs use the migrated [INFO] format', () => {
  assert.strictEqual(api.f1.a('x'), '[INFO] f1:x');
  assert.strictEqual(api.f1.b('x'), '[INFO] f1b:x');
  assert.strictEqual(api.f2.a('q'), '[INFO] f2:q');
  assert.strictEqual(api.f3.b('y'), '[INFO] f3b:y');
  assert.strictEqual(api.f4.a('m'), '[INFO] f4:m');
  assert.strictEqual(api.f5.b('n'), '[INFO] f5b:n');
  assert.strictEqual(api.f6.a('z'), '[INFO] f6:z');
});
