'use strict';
// Throwaway: writes the panel at several states so it can be eyeballed against
// the approved mockup. Not shipped, not a test. The theme variables below stand
// in for what the workbench injects.
const fs = require('fs');
const { describe } = require('../lib/usage');
const { renderPanel } = require('../lib/render');

const NOW = Date.now();
const HOUR = 3600 * 1000;

function epoch(ms) {
  return Math.round(ms / 1000);
}

const live = {
  rate_limits: {
    five_hour: { used_percentage: 26, resets_at: epoch(NOW + 3.6 * HOUR) },
    seven_day: { used_percentage: 17, resets_at: epoch(NOW + 110 * HOUR) },
  },
};
const overBudget = {
  rate_limits: {
    seven_day: { used_percentage: 52, resets_at: epoch(NOW + 110 * HOUR) },
    five_hour: { used_percentage: 94, resets_at: epoch(NOW + 1.2 * HOUR) },
  },
};
const early = {
  rate_limits: {
    five_hour: { used_percentage: 3, resets_at: epoch(NOW + 4.8 * HOUR) },
  },
};

// Left overnight: the five-hour window has rolled past its reset while the
// weekly has only gained headroom. Its windows are anchored to the capture.
const LAST_NIGHT = NOW - 12 * HOUR;
const overnight = {
  rate_limits: {
    five_hour: { used_percentage: 46, resets_at: epoch(LAST_NIGHT + 2 * HOUR) },
    seven_day: { used_percentage: 17, resets_at: epoch(LAST_NIGHT + 110 * HOUR) },
  },
};

const panels = [
  ['live', describe(live, NOW, NOW)],
  ['over budget', describe(overBudget, NOW, NOW)],
  ['early in the window', describe(early, NOW, NOW)],
  ['idle overnight', describe(overnight, LAST_NIGHT, NOW)],
  ['limits do not apply', describe({ rate_limits_available: false }, NOW, NOW)],
  ['not connected', null],
];

const THEMES = [
  ['Paper Contrast', `
    --vscode-sideBar-background: #fbf5df; --vscode-foreground: #3e3d39;
    --vscode-descriptionForeground: #717171; --vscode-progressBar-background: #6547b8;
    --vscode-errorForeground: #ff7575;`],
  // Mocha really does set descriptionForeground equal to foreground. Rendering
  // its actual value is the point: it shows what the sub-lines lose.
  ['Catppuccin Mocha', `
    --vscode-sideBar-background: #181825; --vscode-foreground: #cdd6f4;
    --vscode-descriptionForeground: #cdd6f4; --vscode-progressBar-background: #cba6f7;
    --vscode-errorForeground: #f38ba8;`],
];

const FONT = '--vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;';

const sections = THEMES.map(([themeName, vars]) => {
  const frames = panels.map(([name, state]) => {
    const html = renderPanel(state, NOW)
      .replace('<body>', `<body style="${vars}${FONT}">`)
      .split('"').join('&quot;');
    return `<figure style="margin:0">
      <figcaption style="font:600 11px system-ui;padding-bottom:6px;opacity:.7">${name}</figcaption>
      <iframe style="width:300px;height:230px;border:1px solid #8888" srcdoc="${html}"></iframe>
    </figure>`;
  }).join('');
  return `<h2 style="font:600 13px system-ui">${themeName}</h2>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:28px">${frames}</div>`;
}).join('');

fs.writeFileSync('/tmp/cuv-preview.html',
  `<body style="font-family:system-ui;padding:20px;background:#e9e9e9">${sections}</body>`);
console.log('wrote /tmp/cuv-preview.html');
