'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  initialHealth,
  noteSuccess,
  noteFailure,
  warningFor,
  backoffFor,
  shouldFetch,
  FETCH_INTERVAL_MS,
  BACKOFF_MAX_MS,
} = require('../lib/health');

const MINUTE = 60 * 1000;

function after(kinds) {
  let health = initialHealth();
  for (const kind of kinds) {
    health = noteFailure(health, kind);
  }
  return health;
}

test('backoff doubles from the base interval and stops at the cap', () => {
  const steps = ['rate-limited', 'rate-limited', 'rate-limited', 'rate-limited', 'rate-limited', 'rate-limited'];
  const schedule = [];
  let health = initialHealth();
  schedule.push(backoffFor(health));
  for (const kind of steps) {
    health = noteFailure(health, kind);
    schedule.push(backoffFor(health));
  }

  assert.deepStrictEqual(schedule.map((ms) => ms / MINUTE), [5, 5, 10, 20, 30, 30, 30]);
  assert.strictEqual(backoffFor(health), BACKOFF_MAX_MS);
});

test('one success returns to the base interval', () => {
  const backedOff = after(['rate-limited', 'rate-limited', 'rate-limited']);
  assert.ok(backoffFor(backedOff) > FETCH_INTERVAL_MS);
  assert.strictEqual(backoffFor(noteSuccess()), FETCH_INTERVAL_MS);
});

test('a rate limit backs off but never raises a warning', () => {
  const throttled = after(new Array(5).fill('rate-limited'));

  assert.strictEqual(warningFor(throttled), null, 'transient and self-correcting');
  assert.strictEqual(backoffFor(throttled), BACKOFF_MAX_MS, 'but it must still slow down');
});

test('a resting failure still backs off, so a dead token is not retried hard', () => {
  const expiredToken = after(['unauthorized', 'unauthorized']);

  assert.strictEqual(warningFor(expiredToken), null);
  assert.ok(backoffFor(expiredToken) > FETCH_INTERVAL_MS);
});

test('a window stands down when another refreshed the shared file recently', () => {
  const healthy = noteSuccess();

  const someoneJustFetched = shouldFetch({
    attemptAgeMs: 10 * MINUTE,
    dataAgeMs: 1 * MINUTE,
    health: healthy,
  });
  const dataIsStale = shouldFetch({
    attemptAgeMs: 10 * MINUTE,
    dataAgeMs: 10 * MINUTE,
    health: healthy,
  });

  assert.strictEqual(someoneJustFetched, false, 'four windows must not make four requests');
  assert.strictEqual(dataIsStale, true);
});

test('an attempt by any window holds the others off, so failures do not fan out', () => {
  // A failed fetch leaves the data file untouched, so without a shared record of
  // the attempt every window would retry at the same moment and multiply the load
  // exactly when the endpoint is asking for less.
  const throttled = after(['rate-limited']);

  const justAttempted = shouldFetch({
    attemptAgeMs: 1 * MINUTE,
    dataAgeMs: 60 * MINUTE,
    health: throttled,
  });
  const backoffElapsed = shouldFetch({
    attemptAgeMs: 6 * MINUTE,
    dataAgeMs: 60 * MINUTE,
    health: throttled,
  });

  assert.strictEqual(justAttempted, false);
  assert.strictEqual(backoffElapsed, true);
});

test('nothing has been fetched yet, so the first call goes straight out', () => {
  assert.strictEqual(
    shouldFetch({ attemptAgeMs: Infinity, dataAgeMs: Infinity, health: initialHealth() }),
    true,
  );
});
