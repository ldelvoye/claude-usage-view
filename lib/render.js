'use strict';

function escapeHtml(value) {
  return String(value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

function clampPercent(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function resetLabel(row, now) {
  const remainingMs = row.resetsAt - now;
  if (remainingMs <= 0) {
    return 'resetting';
  }
  const totalMinutes = Math.round(remainingMs / 60000);
  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return 'resets in ' + hours + 'h ' + minutes + 'm';
  }
  const when = new Date(row.resetsAt);
  const weekday = when.toLocaleDateString(undefined, { weekday: 'short' });
  const clock = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return 'resets ' + weekday + ' ' + clock;
}

function readoutLabel(row) {
  if (row.projection === null) {
    return 'too early to call';
  }
  return 'on track for ' + Math.round(row.projection) + '%';
}

function isOverBudget(row) {
  if (row.projection !== null && row.projection > 100) {
    return true;
  }
  return row.used > 90;
}

function renderExpiredRow(row) {
  return [
    '<div class="row">',
    '  <div class="line">',
    '    <span>' + escapeHtml(row.label) + '</span>',
    '    <span class="num sub">&mdash;</span>',
    '  </div>',
    '  <div class="bar"></div>',
    '  <div class="line sub"><span>window reset, awaiting a reading</span></div>',
    '</div>',
  ].join('\n');
}

function renderRow(row, now) {
  if (row.expired) {
    return renderExpiredRow(row);
  }

  const used = clampPercent(row.used);
  const pace = clampPercent(row.pace);

  let fill = 'var(--vscode-progressBar-background)';
  let readoutStyle = '';
  if (isOverBudget(row)) {
    fill = 'var(--vscode-errorForeground)';
    readoutStyle = ' style="color: var(--vscode-errorForeground)"';
  }

  return [
    '<div class="row">',
    '  <div class="line">',
    '    <span>' + escapeHtml(row.label) + '</span>',
    '    <span class="num">' + Math.round(used) + '%</span>',
    '  </div>',
    '  <div class="bar">',
    '    <div class="band" style="width: ' + pace + '%"></div>',
    '    <div class="fill" style="width: ' + used + '%; background: ' + fill + '"></div>',
    '    <div class="edge" style="left: ' + pace + '%"></div>',
    '  </div>',
    '  <div class="line sub">',
    '    <span>' + escapeHtml(resetLabel(row, now)) + '</span>',
    '    <span' + readoutStyle + '>' + escapeHtml(readoutLabel(row)) + '</span>',
    '  </div>',
    '</div>',
  ].join('\n');
}

const STYLE = `
  body {
    margin: 0;
    padding: 12px;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: 13px;
  }
  .rows { display: flex; flex-direction: column; gap: 16px; }
  .row { display: flex; flex-direction: column; gap: 5px; }
  .line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .sub { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .num { font-variant-numeric: tabular-nums; }
  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
  }
  .band, .fill, .edge { position: absolute; top: 0; bottom: 0; }
  .band { left: 0; background: color-mix(in srgb, var(--vscode-progressBar-background) 28%, transparent); }
  .fill { left: 0; }
  /* Drawn in every state: once the fill passes pace it would cover its own reference. */
  .edge { width: 2px; transform: translateX(-1px); background: color-mix(in srgb, var(--vscode-foreground) 45%, transparent); }
  .note { font-size: 11px; color: var(--vscode-descriptionForeground); text-wrap: pretty; }
  .foot { margin-top: 14px; font-size: 11px; color: var(--vscode-descriptionForeground); }
`;

function renderBody(state, now) {
  if (!state) {
    return '<div class="note">Not connected. Run <b>Claude Usage: Show Setup</b>.</div>';
  }
  if (!state.available) {
    return '<div class="note">Plan limits do not apply to this session (API key, Bedrock or Vertex).</div>';
  }
  if (state.rows.length === 0) {
    return '<div class="note">Waiting for the first response in a Claude Code session.</div>';
  }

  const rows = state.rows.map((row) => renderRow(row, now)).join('\n');

  const captured = new Date(state.capturedAt);
  const clock = captured.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return '<div class="rows">' + rows + '</div>'
    + '<div class="foot">as of ' + escapeHtml(clock) + '</div>';
}

function renderPanel(state, now) {
  let at = now;
  if (at === undefined) {
    at = Date.now();
  }
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + STYLE + '</style></head>'
    + '<body>' + renderBody(state, at) + '</body></html>';
}

module.exports = { renderPanel };
