const test = require('node:test');
const assert = require('node:assert');
const api = require('../src/index.js');

// These assertions expect the POST-UPGRADE behavior (jsonfmt v2 installed AND
// every caller migrated to pass an explicit { pretty } option):
//   - report(...)  renders PRETTY (2-space indented) JSON  -> callers pass {pretty:true}
//   - summary(...) renders COMPACT (single-line) JSON       -> callers pass {pretty:false}
//
// On the BASELINE (jsonfmt v1 + single-arg callers) report/summary are
// indistinguishable compact JSON, so the pretty assertions below FAIL.
test('report renders pretty (2-space) JSON', () => {
  assert.strictEqual(api.report({ a: 1 }), '{\n  "a": 1\n}');
  assert.strictEqual(
    api.reportWrapped({ c: 3 }),
    '{\n  "wrapped": {\n    "c": 3\n  }\n}',
  );
});

test('summary renders compact JSON', () => {
  assert.strictEqual(api.summary({ b: 2 }), '{"b":2}');
  assert.strictEqual(api.summaryWrapped({ d: 4 }), '{"wrapped":{"d":4}}');
});
