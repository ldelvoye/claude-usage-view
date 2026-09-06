'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const { describeMany } = require('./lib/usage');
const { planSetup } = require('./lib/setup');
const { renderShell, renderBody } = require('./lib/render');

const REFRESH_MS = 20 * 1000;
const WATCH_DEBOUNCE_MS = 150;
const ABANDONED_AFTER_MS = 7 * 24 * 3600 * 1000;
const MAX_STATE_FILES = 50;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, 'claude-usage');
const SCRIPT_FILE = path.join(CLAUDE_DIR, 'claude-usage-statusline.sh');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

// The wiring names this path forever, so the script cannot be run from the
// extension directory: that path carries the version and moves on every update.
function installScript(context) {
  const source = path.join(context.extensionPath, 'statusline.sh');
  let shipped;
  try {
    shipped = fs.readFileSync(source, 'utf8');
  } catch (err) {
    return;
  }

  let installed = null;
  try {
    installed = fs.readFileSync(SCRIPT_FILE, 'utf8');
  } catch (err) {
    installed = null;
  }
  if (installed === shipped) {
    return;
  }

  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(SCRIPT_FILE, shipped, { mode: 0o755 });
  } catch (err) {
    vscode.window.showWarningMessage(
      'Claude Usage: could not install the status line script: ' + err.message,
    );
  }
}

// One file per status line process. Every live session contributes, because a
// session reports only the buckets its own process knows about.
function readState() {
  let names;
  try {
    names = fs.readdirSync(STATE_DIR);
  } catch (err) {
    return null;
  }

  const readings = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const full = path.join(STATE_DIR, name);
      const stat = fs.statSync(full);
      const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
      readings.push({ payload, capturedAt: stat.mtimeMs });
    } catch (err) {
      continue;
    }
  }

  if (readings.length === 0) {
    return null;
  }
  return describeMany(readings, Date.now());
}

// Every session opened leaves a file behind. A reading older than the longest
// window describes only windows that have since reset, so it can no longer
// contribute anything; the count cap covers churn faster than that.
function pruneAbandoned() {
  let names;
  try {
    names = fs.readdirSync(STATE_DIR);
  } catch (err) {
    return;
  }

  const cutoff = Date.now() - ABANDONED_AFTER_MS;
  const living = [];
  for (const name of names) {
    const full = path.join(STATE_DIR, name);
    try {
      const modified = fs.statSync(full).mtimeMs;
      if (modified < cutoff) {
        fs.unlinkSync(full);
      } else {
        living.push({ full, modified });
      }
    } catch (err) {
      continue;
    }
  }

  if (living.length <= MAX_STATE_FILES) {
    return;
  }
  living.sort((a, b) => b.modified - a.modified);
  for (const stale of living.slice(MAX_STATE_FILES)) {
    try {
      fs.unlinkSync(stale.full);
    } catch (err) {
      continue;
    }
  }
}

class UsagePanel {
  constructor() {
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderShell(crypto.randomBytes(16).toString('hex'));

    // The shell announces itself once its listener is attached; a refresh posted
    // before that would be dropped.
    view.webview.onDidReceiveMessage(() => this.refresh());
    view.onDidChangeVisibility(() => this.refresh());
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  refresh() {
    if (!this.view || !this.view.visible) {
      return;
    }
    this.view.webview.postMessage({ html: renderBody(readState(), Date.now()) });
  }
}

function readSettings() {
  try {
    return fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (err) {
    return '{}';
  }
}

function showSetup() {
  const plan = planSetup({ settingsText: readSettings(), scriptPath: SCRIPT_FILE });

  if (plan.state === 'wired') {
    vscode.window.showInformationMessage(
      'Claude Usage: already wired, delegating to ' + plan.inner,
    );
    return;
  }
  if (plan.state === 'wired-no-inner') {
    vscode.window.showInformationMessage(
      'Claude Usage: already wired, with no inner status line set.',
    );
    return;
  }

  const block = JSON.stringify(
    { statusLine: { type: 'command', command: plan.command, refreshInterval: 30 } },
    null,
    2,
  );

  vscode.window
    .showInformationMessage('Claude Usage: add this to ~/.claude/settings.json', 'Copy')
    .then((choice) => {
      if (choice === 'Copy') {
        vscode.env.clipboard.writeText(block);
      }
    });

  vscode.workspace
    .openTextDocument({ language: 'json', content: block })
    .then((doc) => vscode.window.showTextDocument(doc, { preview: true }));
}

function activate(context) {
  installScript(context);

  const panel = new UsagePanel();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeUsage.panel', panel),
    vscode.commands.registerCommand('claudeUsage.refresh', () => panel.refresh()),
    vscode.commands.registerCommand('claudeUsage.showSetup', showSetup),
  );

  // Pace advances on wall-clock time, so the panel redraws even when no new
  // reading arrives.
  const timer = setInterval(() => {
    pruneAbandoned();
    panel.refresh();
  }, REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Several sessions writing at once raise a burst of events, so they are
  // coalesced into one refresh.
  let pending = null;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    pruneAbandoned();
    const watcher = fs.watch(STATE_DIR, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) {
        return;
      }
      clearTimeout(pending);
      pending = setTimeout(() => panel.refresh(), WATCH_DEBOUNCE_MS);
    });
    context.subscriptions.push({
      dispose: () => {
        clearTimeout(pending);
        watcher.close();
      },
    });
  } catch (err) {
    // Without a watcher the timer still refreshes, so this is not worth a prompt.
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
