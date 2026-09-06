'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const { describe } = require('./lib/usage');
const { planSetup } = require('./lib/setup');
const { renderPanel } = require('./lib/render');

const REFRESH_MS = 20 * 1000;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATE_FILE = path.join(CLAUDE_DIR, 'claude-usage-state.json');
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

function readState() {
  let raw;
  let stat;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
    stat = fs.statSync(STATE_FILE);
  } catch (err) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  return describe(payload, stat.mtimeMs, Date.now());
}

class UsagePanel {
  constructor() {
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: false };
    this.refresh();
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  refresh() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = renderPanel(readState());
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
  const timer = setInterval(() => panel.refresh(), REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // The script replaces the state file by rename, which kills a watch bound to
  // the old inode. Watch the directory instead.
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    const watcher = fs.watch(CLAUDE_DIR, (eventType, filename) => {
      if (filename === path.basename(STATE_FILE)) {
        panel.refresh();
      }
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (err) {
    // Without a watcher the timer still refreshes, so this is not worth a prompt.
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
