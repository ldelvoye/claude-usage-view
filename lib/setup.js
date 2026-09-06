'use strict';

const path = require('path');

function shellQuote(value) {
  const escaped = value.split("'").join("'\\''");
  return "'" + escaped + "'";
}

function currentCommand(settingsText) {
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch (err) {
    return null;
  }
  if (!settings || !settings.statusLine) {
    return null;
  }
  const command = settings.statusLine.command;
  if (typeof command !== 'string') {
    return null;
  }
  const trimmed = command.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed;
}

function unquote(value) {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  const quoted = value.length >= 2 && first === last && (first === "'" || first === '"');
  if (!quoted) {
    return value;
  }
  return value.slice(1, -1);
}

// Claude Code runs this command through a shell, Git Bash on Windows, which eats
// unquoted backslashes as escapes so a native Windows path never resolves. The ~
// shorthand is accepted everywhere and sidesteps the separator entirely.
function portablePath(absolutePath, homeDir) {
  const forwardSlashed = absolutePath.split('\\').join('/');
  const home = String(homeDir || '').split('\\').join('/');
  if (home && forwardSlashed.startsWith(home)) {
    return '~' + forwardSlashed.slice(home.length);
  }
  return forwardSlashed;
}

function planSetup({ settingsText, scriptPath, homeDir }) {
  const script = portablePath(scriptPath, homeDir);
  const existing = currentCommand(settingsText);
  if (existing === null) {
    return { state: 'unwired-none', command: script, inner: null };
  }

  // Match on the basename so a wiring keeps being recognised after the script
  // moves, and so setup can never nest a second copy of itself.
  const basename = path.posix.basename(script);
  const at = existing.indexOf(basename);
  if (at === -1) {
    return {
      state: 'unwired-existing',
      command: script + ' ' + shellQuote(existing),
      inner: existing,
    };
  }

  const trailing = existing.slice(at + basename.length).trim();
  if (trailing === '') {
    return { state: 'wired-no-inner', command: null, inner: null };
  }
  return { state: 'wired', command: null, inner: unquote(trailing) };
}

module.exports = { planSetup, shellQuote, portablePath };
