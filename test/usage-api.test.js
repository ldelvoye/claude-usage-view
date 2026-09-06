'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { payloadFromUsageApi } = require('../lib/usage-api');
const { describeMany } = require('../lib/usage');

// Shape observed live from GET /api/oauth/usage on 2026-09-05.
const RESPONSE = {
  limits: [
    { kind: 'session', group: 'session', percent: 61, resets_at: '2026-09-06T01:49:59.648260+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 24, resets_at: '2026-09-10T11:59:59.648286+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 30,
      resets_at: '2026-09-10T11:59:59.648510+00:00',
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
};

test('the usage endpoint reshapes into the same form as a status line payload', () => {
  const payload = payloadFromUsageApi(RESPONSE);
  const now = Date.parse('2026-09-05T18:00:00Z');
  const result = describeMany([{ payload, capturedAt: now }], now);

  assert.deepStrictEqual(
    result.rows.map((row) => row.label),
    ['Current session', 'All models', 'Fable'],
  );
  assert.strictEqual(result.rows[2].used, 30, 'the per-model bucket the status line never sends');
  assert.strictEqual(result.rows[2].key, 'model_scoped:Fable');
});

test('a fetched reading outranks a staler status line one for the same window', () => {
  const fetched = payloadFromUsageApi(RESPONSE);
  const fromStatusLine = {
    rate_limits: {
      five_hour: { used_percentage: 60, resets_at: Math.round(Date.parse('2026-09-06T01:49:59Z') / 1000) },
      seven_day: { used_percentage: 23, resets_at: Math.round(Date.parse('2026-09-10T11:59:59Z') / 1000) },
    },
  };
  const now = Date.parse('2026-09-05T18:00:00Z');

  const merged = describeMany([
    { payload: fromStatusLine, capturedAt: now },
    { payload: fetched, capturedAt: now },
  ], now);

  assert.strictEqual(merged.rows[0].used, 61);
  assert.strictEqual(merged.rows[1].used, 24);
  assert.strictEqual(merged.rows.length, 3, 'Fable survives the merge');
});

test('an unusable body yields nothing rather than an empty panel', () => {
  assert.strictEqual(payloadFromUsageApi(null), null);
  assert.strictEqual(payloadFromUsageApi({}), null);
  assert.strictEqual(payloadFromUsageApi({ limits: [] }), null);
  assert.strictEqual(payloadFromUsageApi({ limits: [{ kind: 'session' }] }), null);
});
