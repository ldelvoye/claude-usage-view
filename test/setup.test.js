'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { planSetup, shellQuote } = require('../lib/setup');

const SCRIPT = '/Users/someone/.claude/claude-usage-statusline.sh';

function settingsWith(command) {
  return JSON.stringify({ statusLine: { type: 'command', command } });
}

test('no status line at all yields the bare form', () => {
  const result = planSetup({ settingsText: '{}', scriptPath: SCRIPT });

  assert.strictEqual(result.state, 'unwired-none');
  assert.strictEqual(result.command, SCRIPT);
});

test('an existing status line is preserved as the inner argument', () => {
  const result = planSetup({
    settingsText: settingsWith('~/.claude/statusline-command.sh'),
    scriptPath: SCRIPT,
  });

  assert.strictEqual(result.state, 'unwired-existing');
  assert.strictEqual(result.command, SCRIPT + " '~/.claude/statusline-command.sh'");
});

test('an inner carrying its own arguments survives intact as one argument', () => {
  const result = planSetup({
    settingsText: settingsWith('python3 ~/bin/statusline.py --compact'),
    scriptPath: SCRIPT,
  });

  assert.strictEqual(result.command, SCRIPT + " 'python3 ~/bin/statusline.py --compact'");
});

test('an already-wired status line is detected rather than nested', () => {
  const result = planSetup({
    settingsText: settingsWith(SCRIPT + " '~/.claude/statusline-command.sh'"),
    scriptPath: SCRIPT,
  });

  assert.strictEqual(result.state, 'wired');
  assert.strictEqual(result.inner, '~/.claude/statusline-command.sh');
  assert.strictEqual(result.command, null);
});

test('wired with no inner is distinguished from wired with one', () => {
  const result = planSetup({ settingsText: settingsWith(SCRIPT), scriptPath: SCRIPT });

  assert.strictEqual(result.state, 'wired-no-inner');
  assert.strictEqual(result.inner, null);
  assert.strictEqual(result.command, null);
});

test('unreadable or empty settings are treated as no status line, not as an error', () => {
  const unparsable = planSetup({ settingsText: 'not json {{{', scriptPath: SCRIPT });
  const blank = planSetup({ settingsText: settingsWith('   '), scriptPath: SCRIPT });

  assert.strictEqual(unparsable.state, 'unwired-none');
  assert.strictEqual(blank.state, 'unwired-none');
});

test('an inner containing a single quote stays one shell argument', () => {
  assert.strictEqual(shellQuote("it's here"), "'it'\\''s here'");
});
