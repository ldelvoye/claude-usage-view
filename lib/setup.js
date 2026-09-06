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

function planSetup({ settingsText, scriptPath }) {
  const existing = currentCommand(settingsText);
  if (existing === null) {
    return { state: 'unwired-none', command: scriptPath, inner: null };
  }

  // Match on the basename so a wiring keeps being recognised after the script
  // moves, and so setup can never nest a second copy of itself.
  const basename = path.basename(scriptPath);
  const at = existing.indexOf(basename);
  if (at === -1) {
    return {
      state: 'unwired-existing',
      command: scriptPath + ' ' + shellQuote(existing),
      inner: existing,
    };
  }

  const trailing = existing.slice(at + basename.length).trim();
  if (trailing === '') {
    return { state: 'wired-no-inner', command: null, inner: null };
  }
  return { state: 'wired', command: null, inner: unquote(trailing) };
}

module.exports = { planSetup, shellQuote };
