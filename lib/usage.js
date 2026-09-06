'use strict';

const FIVE_HOURS = 5 * 3600 * 1000;
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

// Order here is the order rows appear in the panel.
const FIXED_WINDOWS = [
  ['five_hour', 'Current session', FIVE_HOURS],
  ['seven_day', 'All models', SEVEN_DAYS],
  ['seven_day_opus', 'Opus', SEVEN_DAYS],
  ['seven_day_sonnet', 'Sonnet', SEVEN_DAYS],
  ['seven_day_oauth_apps', 'OAuth apps', SEVEN_DAYS],
];

const MIN_PACE_FOR_PROJECTION = 0.1;

// The status line sends used_percentage with an epoch-second resets_at; the
// /usage endpoint sends utilization with an ISO 8601 one. Accept both so the
// panel keeps working if the two envelopes ever converge.
function usedPercentageOf(entry) {
  if (!entry) {
    return null;
  }
  if (typeof entry.used_percentage === 'number') {
    return entry.used_percentage;
  }
  if (typeof entry.utilization === 'number') {
    return entry.utilization;
  }
  return null;
}

function resetsAtOf(entry) {
  if (!entry || entry.resets_at === null || entry.resets_at === undefined) {
    return null;
  }
  if (typeof entry.resets_at === 'number') {
    return entry.resets_at * 1000;
  }
  const parsed = Date.parse(entry.resets_at);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function toRow(key, label, windowMs, entry) {
  const used = usedPercentageOf(entry);
  const resetsAt = resetsAtOf(entry);
  if (used === null || resetsAt === null) {
    return null;
  }
  return { key, label, used, resetsAt, windowMs };
}

function readWindows(payload) {
  if (!payload || !payload.rate_limits) {
    return [];
  }
  const limits = payload.rate_limits;
  const rows = [];

  for (const [key, label, windowMs] of FIXED_WINDOWS) {
    const row = toRow(key, label, windowMs, limits[key]);
    if (row) {
      rows.push(row);
    }
  }

  const scoped = limits.model_scoped;
  if (Array.isArray(scoped)) {
    for (const entry of scoped) {
      if (!entry || !entry.display_name) {
        continue;
      }
      const key = 'model_scoped:' + entry.display_name;
      const row = toRow(key, entry.display_name, SEVEN_DAYS, entry);
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function paceOf(row, at) {
  const start = row.resetsAt - row.windowMs;
  const elapsed = at - start;
  const fraction = elapsed / row.windowMs;
  if (fraction < 0) {
    return 0;
  }
  if (fraction > 1) {
    return 1;
  }
  return fraction;
}

function projectionOf(used, pace) {
  if (pace < MIN_PACE_FOR_PROJECTION) {
    return null;
  }
  return used / pace;
}

function describe(payload, capturedAtMs, nowMs) {
  let available = true;
  if (payload && payload.rate_limits_available === false) {
    available = false;
  }

  // Pace tracks wall-clock even when the reading is old. The state file stops
  // being written because no session is running, which is also why usage is not
  // climbing, so the widening gap is real headroom rather than a stale artefact.
  const rows = readWindows(payload).map(function (row) {
    // Past resets_at the window has rolled over and this reading describes a
    // window that no longer exists, so its number is wrong rather than old.
    const expired = nowMs >= row.resetsAt;
    if (expired) {
      return {
        key: row.key,
        label: row.label,
        used: 0,
        resetsAt: row.resetsAt,
        pace: 0,
        projection: null,
        expired: true,
      };
    }

    const pace = paceOf(row, nowMs);
    return {
      key: row.key,
      label: row.label,
      used: row.used,
      resetsAt: row.resetsAt,
      pace: pace * 100,
      projection: projectionOf(row.used, pace),
      expired: false,
    };
  });

  return { available, capturedAt: capturedAtMs, rows };
}

module.exports = { describe, MIN_PACE_FOR_PROJECTION };
