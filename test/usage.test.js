'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { describe, describeMany } = require('../lib/usage');

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

test('pace keeps advancing on an old reading, growing the headroom it really earned', () => {
  const rateLimits = {
    seven_day: { used_percentage: 17, resets_at: epoch(NOW + 110 * HOUR) },
  };

  const atCapture = describe(payload(rateLimits), NOW, NOW);
  const twelveHoursIdle = describe(payload(rateLimits), NOW, NOW + 12 * HOUR);

  assert.strictEqual(Math.round(atCapture.rows[0].pace), 35);
  assert.strictEqual(Math.round(twelveHoursIdle.rows[0].pace), 42);
  assert.strictEqual(twelveHoursIdle.rows[0].used, 17, 'usage is not invented, only pace moves');
  assert.ok(twelveHoursIdle.rows[0].projection < atCapture.rows[0].projection);
});

test('a window read past its own reset is reported as expired, not as its old number', () => {
  const rateLimits = {
    five_hour: { used_percentage: 46, resets_at: epoch(NOW + 2 * HOUR) },
    seven_day: { used_percentage: 20, resets_at: epoch(NOW + 110 * HOUR) },
  };

  // Idle overnight: the five-hour window has rolled over, the weekly has not.
  const nextMorning = describe(payload(rateLimits), NOW, NOW + 10 * HOUR);
  const [session, weekly] = nextMorning.rows;

  assert.strictEqual(session.expired, true);
  assert.strictEqual(session.used, 0, 'yesterday 46% must not be shown as current');
  assert.strictEqual(session.projection, null);
  assert.strictEqual(weekly.expired, false);
  assert.strictEqual(weekly.used, 20);
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

test('concurrent sessions merge per bucket instead of overwriting each other', () => {
  // Both shapes observed live on 2026-09-05: an Opus session on 2.1.261
  // reporting two buckets, and an older Fable session on 2.1.260 reporting only
  // seven_day, with a staler figure. Alternating writes made the session row
  // disappear and the weekly figure flip.
  const opusSession = payload({
    five_hour: { used_percentage: 58, resets_at: epoch(NOW + 1.2 * HOUR) },
    seven_day: { used_percentage: 23, resets_at: epoch(NOW + 110 * HOUR) },
  });
  const fableSession = payload({
    seven_day: { used_percentage: 9, resets_at: epoch(NOW + 110 * HOUR) },
  });

  const merged = describeMany([
    { payload: opusSession, capturedAt: NOW - 1000 },
    { payload: fableSession, capturedAt: NOW },
  ], NOW);

  assert.deepStrictEqual(merged.rows.map((row) => row.label), ['Current session', 'All models']);
  assert.strictEqual(merged.rows[0].used, 58, 'a session missing a bucket must not erase it');
  assert.strictEqual(merged.rows[1].used, 23, 'the higher reading is the more current one');

  // Reading the same sessions in the other order must not reorder the panel.
  const reversed = describeMany([
    { payload: fableSession, capturedAt: NOW },
    { payload: opusSession, capturedAt: NOW - 1000 },
  ], NOW);

  assert.deepStrictEqual(
    reversed.rows.map((row) => row.label),
    merged.rows.map((row) => row.label),
    'row order must not depend on which session was read first',
  );
});

test('a newer window beats a higher reading from the window it replaced', () => {
  const oldWindow = payload({
    five_hour: { used_percentage: 90, resets_at: epoch(NOW + 0.5 * HOUR) },
  });
  const newWindow = payload({
    five_hour: { used_percentage: 4, resets_at: epoch(NOW + 4.9 * HOUR) },
  });

  const merged = describeMany([
    { payload: oldWindow, capturedAt: NOW - 5000 },
    { payload: newWindow, capturedAt: NOW },
  ], NOW);

  assert.strictEqual(merged.rows.length, 1);
  assert.strictEqual(merged.rows[0].used, 4, 'usage resets with the window');
});

test('one session without plan limits does not blank the panel for the others', () => {
  const apiKeySession = payload(null, { rate_limits_available: false });
  const planSession = payload({
    seven_day: { used_percentage: 23, resets_at: epoch(NOW + 110 * HOUR) },
  });

  const merged = describeMany([
    { payload: planSession, capturedAt: NOW - 1000 },
    { payload: apiKeySession, capturedAt: NOW },
  ], NOW);

  assert.strictEqual(merged.available, true);
  assert.strictEqual(merged.rows.length, 1);
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
