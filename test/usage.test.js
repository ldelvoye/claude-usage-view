'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { describe } = require('../lib/usage');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-05T15:00:00Z');

function epoch(ms) {
  return Math.round(ms / 1000);
}

function payload(rateLimits, extra) {
  return Object.assign({ rate_limits: rateLimits }, extra);
}

test('renders only the buckets present, in the panel order', () => {
  const result = describe(payload({
    five_hour: { used_percentage: 46, resets_at: epoch(NOW + 3.6 * HOUR) },
    seven_day: { used_percentage: 20, resets_at: epoch(NOW + 110 * HOUR) },
    seven_day_opus: null,
  }), NOW, NOW);

  assert.deepStrictEqual(result.rows.map((row) => row.label), ['Current session', 'All models']);
});

test('a model_scoped entry becomes a row named by its display_name', () => {
  // Claude Code 2.1.261 does not deliver model_scoped to a status line command;
  // this pins the behaviour for a payload that ever does.
  const result = describe(payload({
    seven_day: { used_percentage: 20, resets_at: epoch(NOW + 110 * HOUR) },
    model_scoped: [
      { display_name: 'Fable', utilization: 27, resets_at: new Date(NOW + 110 * HOUR).toISOString() },
    ],
  }), NOW, NOW);

  assert.deepStrictEqual(result.rows.map((row) => row.label), ['All models', 'Fable']);
  assert.strictEqual(result.rows[1].key, 'model_scoped:Fable');
  assert.strictEqual(result.rows[1].used, 27);
});

test('accepts either field spelling and either resets_at encoding', () => {
  const statusLineShape = describe(payload({
    five_hour: { used_percentage: 46, resets_at: epoch(NOW + 3.6 * HOUR) },
  }), NOW, NOW);
  const usageEndpointShape = describe(payload({
    five_hour: { utilization: 46, resets_at: new Date(NOW + 3.6 * HOUR).toISOString() },
  }), NOW, NOW);

  assert.strictEqual(statusLineShape.rows[0].used, 46);
  assert.strictEqual(usageEndpointShape.rows[0].used, 46);
  assert.strictEqual(statusLineShape.rows[0].resetsAt, usageEndpointShape.rows[0].resetsAt);
});

test('pace is the elapsed fraction of the window, and projection extrapolates it', () => {
  const result = describe(payload({
    five_hour: { used_percentage: 26, resets_at: epoch(NOW + 3.6 * HOUR) },
    seven_day: { used_percentage: 17, resets_at: epoch(NOW + 110 * HOUR) },
  }), NOW, NOW);

  assert.strictEqual(Math.round(result.rows[0].pace), 28);
  assert.strictEqual(Math.round(result.rows[0].projection), 93);
  assert.strictEqual(Math.round(result.rows[1].pace), 35);
  assert.strictEqual(Math.round(result.rows[1].projection), 49);
});

test('projection is withheld until a tenth of the window has elapsed', () => {
  const result = describe(payload({
    five_hour: { used_percentage: 3, resets_at: epoch(NOW + 4.8 * HOUR) },
  }), NOW, NOW);

  assert.strictEqual(result.rows[0].projection, null);
  assert.strictEqual(result.rows[0].used, 3, 'the bar still renders, only the readout is suppressed');
});

test('a stale reading freezes pace at capture time instead of letting it advance', () => {
  const rateLimits = {
    seven_day: { used_percentage: 17, resets_at: epoch(NOW + 110 * HOUR) },
  };

  const atCapture = describe(payload(rateLimits), NOW, NOW);
  const live = describe(payload(rateLimits), NOW, NOW + 10 * 1000);
  const stale = describe(payload(rateLimits), NOW, NOW + 2 * DAY);

  assert.strictEqual(live.stale, false);
  assert.strictEqual(stale.stale, true);

  // While live, pace tracks wall-clock time.
  assert.ok(live.rows[0].pace > atCapture.rows[0].pace);

  // Once stale it stops dead at the capture instant. Two days of drift would
  // otherwise carry pace from 35% to 63% and make an untouched panel look
  // steadily healthier.
  assert.strictEqual(stale.rows[0].pace, atCapture.rows[0].pace);
  assert.strictEqual(stale.rows[0].projection, atCapture.rows[0].projection);
  assert.ok(stale.rows[0].pace < 40, 'pace must not advance once the reading is stale');
});

test('plan limits count as available unless explicitly denied', () => {
  const absent = describe(payload({
    five_hour: { used_percentage: 46, resets_at: epoch(NOW + 3.6 * HOUR) },
  }), NOW, NOW);
  const denied = describe(payload(null, { rate_limits_available: false }), NOW, NOW);

  assert.strictEqual(absent.available, true, 'the status line omits the flag entirely');
  assert.strictEqual(denied.available, false);
  assert.deepStrictEqual(denied.rows, []);
});

test('the captured payload produces usable rows', () => {
  const captured = require('./fixtures/payload.json');
  const now = Date.now();
  const result = describe(captured, now, now);

  assert.ok(result.rows.length > 0, 'expected at least one window from the fixture');
  for (const row of result.rows) {
    assert.ok(row.used >= 0 && row.used <= 100, `used out of range for ${row.key}`);
    assert.ok(row.pace >= 0 && row.pace <= 100, `pace out of range for ${row.key}`);
    assert.ok(Number.isFinite(row.resetsAt), `resetsAt not a timestamp for ${row.key}`);
  }
});
