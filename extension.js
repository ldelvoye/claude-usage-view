'use strict';

const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const { describeMany } = require('./lib/usage');
const { planSetup } = require('./lib/setup');
const { payloadFromUsageApi } = require('./lib/usage-api');
const {
  initialHealth,
  isPending,
  noteSuccess,
  noteFailure,
  warningFor,
  emptyReasonFor,
  shouldFetch,
} = require('./lib/health');
const { renderShell, renderBody } = require('./lib/render');

const REFRESH_MS = 20 * 1000;
const WATCH_DEBOUNCE_MS = 150;
const ABANDONED_AFTER_MS = 7 * 24 * 3600 * 1000;
const MAX_STATE_FILES = 50;
const USAGE_FETCH_TIMEOUT_MS = 5000;
const ENDPOINT_FILE = '_endpoint.json';
const ATTEMPT_FILE = '_endpoint.attempt';
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

// The fetched reading is written alongside the session files rather than held in
// memory, so it survives a reload and is merged by the same rule as the rest.
// Once the token expires it simply stops being updated, and the panel carries on
// against it with pace still advancing.
let health = initialHealth();

function ageOf(name) {
  try {
    return Date.now() - fs.statSync(path.join(STATE_DIR, name)).mtimeMs;
  } catch (err) {
    return Infinity;
  }
}

function refreshFetched(onDone) {
  const gate = {
    attemptAgeMs: ageOf(ATTEMPT_FILE),
    dataAgeMs: ageOf(ENDPOINT_FILE),
    health,
  };
  if (!shouldFetch(gate)) {
    return;
  }

  // Recorded before the request so the other windows see it whether or not this
  // one succeeds.
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, ATTEMPT_FILE), '');
  } catch (err) {
    return;
  }

  fetchUsage((payload, reason) => {
    if (!payload) {
      health = noteFailure(health, reason);
      onDone();
      return;
    }
    health = noteSuccess();
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const target = path.join(STATE_DIR, ENDPOINT_FILE);
      fs.writeFileSync(target + '.tmp', JSON.stringify(payload));
      fs.renameSync(target + '.tmp', target);
    } catch (err) {
      return;
    }
    onDone();
  });
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

// Proof of concept. The status line envelope carries no per-model buckets, so
// Fable and friends only exist on the endpoint /usage itself calls. The token is
// read but never refreshed or written back: Claude Code owns that lifecycle, and
// two processes rotating one credential would race. A stale token means a 401
// and one missing row, which is why nothing else depends on this succeeding.
function readOauthToken(callback) {
  if (process.platform !== 'darwin') {
    callback(null, 'unsupported');
    return;
  }
  execFile(
    '/usr/bin/security',
    ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
    { encoding: 'utf8', timeout: 5000 },
    (err, stdout) => {
      if (err) {
        callback(null, 'no-token');
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        callback(parsed.claudeAiOauth.accessToken, null);
      } catch (parseErr) {
        callback(null, 'no-token');
      }
    },
  );
}

function fetchUsage(callback) {
  readOauthToken((token, reason) => {
    if (!token) {
      callback(null, reason || 'no-token');
      return;
    }
    requestUsage(token, callback);
  });
}

function requestUsage(token, callback) {
  const request = https.request(
    {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      timeout: USAGE_FETCH_TIMEOUT_MS,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    },
    (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          callback(null, 'unauthorized');
          return;
        }
        if (response.statusCode === 429) {
          callback(null, 'rate-limited');
          return;
        }
        if (response.statusCode !== 200) {
          callback(null, 'bad-status');
          return;
        }
        let payload = null;
        try {
          payload = payloadFromUsageApi(JSON.parse(body));
        } catch (err) {
          payload = null;
        }
        if (!payload) {
          callback(null, 'unparseable');
          return;
        }
        callback(payload, null);
      });
    },
  );
  request.on('error', () => callback(null, 'unreachable'));
  request.on('timeout', () => request.destroy());
  request.end();
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
    refreshFetched(() => this.refresh());
    const notice = {
      warning: warningFor(health),
      emptyReason: emptyReasonFor(health),
      pending: isPending(health),
    };
    this.view.webview.postMessage({ html: renderBody(readState(), Date.now(), notice) });
  }
}

function readSettings() {
  try {
    return fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (err) {
    return '{}';
  }
}

// The notification already carries "Source: Claude Usage", so repeating it in the
// text wastes a line, and absolute home paths wrap over three.
function shorten(absolutePath) {
  const home = os.homedir();
  if (absolutePath.startsWith(home)) {
    return '~' + absolutePath.slice(home.length);
  }
  return absolutePath;
}

function showSetup() {
  const plan = planSetup({
    settingsText: readSettings(),
    scriptPath: SCRIPT_FILE,
    homeDir: os.homedir(),
  });

  if (plan.state === 'wired') {
    vscode.window.showInformationMessage('Already feeding the panel, through ' + shorten(plan.inner));
    return;
  }
  if (plan.state === 'wired-no-inner') {
    vscode.window.showInformationMessage('Already feeding the panel. No status line of your own is set.');
    return;
  }

  const block = JSON.stringify(
    { statusLine: { type: 'command', command: plan.command, refreshInterval: 30 } },
    null,
    2,
  );

  // One surface rather than a toast and a document for the same small block. It
  // opens as jsonc so the instructions can travel with the thing being copied.
  const document = [
    '// Optional. Add this to ~/.claude/settings.json to keep the panel fed when',
    '// the access token expires, when you are offline, or on a machine without a',
    '// keychain. Your own status line is preserved as the argument and keeps',
    '// rendering exactly as it does now.',
    '',
    block.replace(/^\{\n|\n\}$/g, '').replace(/^ {2}/gm, ''),
    '',
  ].join('\n');

  vscode.workspace
    .openTextDocument({ language: 'jsonc', content: document })
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
