'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  initialHealth,
  noteSuccess,
  noteFailure,
  warningFor,
  emptyReasonFor,
} = require('../lib/health');

function after(kinds) {
  let health = initialHealth();
  for (const kind of kinds) {
    health = noteFailure(health, kind);
  }
  return health;
}

test('a warning appears only on the third consecutive failure', () => {
  assert.strictEqual(warningFor(after(['unreachable'])), null);
  assert.strictEqual(warningFor(after(['unreachable', 'unreachable'])), null);
  assert.ok(warningFor(after(['unreachable', 'unreachable', 'unreachable'])));
});

test('one success clears the warning', () => {
  assert.ok(warningFor(after(['unparseable', 'unparseable', 'unparseable'])));
  assert.strictEqual(warningFor(noteSuccess()), null);
});

test('the resting states never warn, however often they happen', () => {
  for (const kind of ['unauthorized', 'unsupported', 'no-token']) {
    assert.strictEqual(warningFor(after(new Array(20).fill(kind))), null, kind);
  }
});

test('a resting state neither accumulates toward a warning nor clears one', () => {
  const twoRealFailures = after(['unreachable', 'unreachable']);
  const interrupted = noteFailure(twoRealFailures, 'unauthorized');

  assert.strictEqual(interrupted.consecutive, 2, 'a 401 is not evidence either way');
  assert.ok(warningFor(noteFailure(interrupted, 'unreachable')));
});

test('the message names what broke, since the fixes differ', () => {
  const changed = warningFor(after(['unparseable', 'unparseable', 'unparseable']));
  const offline = warningFor(after(['unreachable', 'unreachable', 'unreachable']));

  assert.match(changed, /unexpected/);
  assert.match(offline, /Cannot reach/);
  assert.notStrictEqual(changed, offline);
});

test('the latest kind decides the message when failures differ', () => {
  assert.match(warningFor(after(['unreachable', 'bad-status', 'unparseable'])), /unexpected/);
});

test('a session with no plan is explained, not told to run setup', () => {
  const apiKeyUser = after(['no-token']);

  assert.strictEqual(warningFor(apiKeyUser), null, 'having no plan is not a fault');
  assert.match(emptyReasonFor(apiKeyUser), /API key, Bedrock and Vertex/);
});

test('a platform without a keychain is pointed at the status line instead', () => {
  assert.match(emptyReasonFor(after(['unsupported'])), /Show Status Line Setup/);
});

test('a real failure gets no empty-state explanation, only a warning', () => {
  const broken = after(['unreachable', 'unreachable', 'unreachable']);
  assert.strictEqual(emptyReasonFor(broken), null);
  assert.ok(warningFor(broken));
});
