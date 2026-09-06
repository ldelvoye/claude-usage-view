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

// Concurrent sessions each report what their own process knows, so the same
// bucket arrives more than once with different figures. Usage only climbs inside
// a window, which makes the larger reading the more current one; a later
// resets_at means a newer window and wins outright.
function preferReading(current, candidate) {
  if (!current) {
    return candidate;
  }
  if (candidate.resetsAt > current.resetsAt) {
    return candidate;
  }
  if (candidate.resetsAt < current.resetsAt) {
    return current;
  }
  if (candidate.used > current.used) {
    return candidate;
  }
  return current;
}

// Merged rows arrive in whatever order the readings were read in, so they are
// put back into the panel's own order. Without this the rows swap places
// whenever the directory listing changes.
function panelRank(key) {
  const fixed = FIXED_WINDOWS.findIndex(([candidate]) => candidate === key);
  if (fixed !== -1) {
    return fixed;
  }
  return FIXED_WINDOWS.length;
}

function compareRows(a, b) {
  const byRank = panelRank(a.key) - panelRank(b.key);
  if (byRank !== 0) {
    return byRank;
  }
  return a.label.localeCompare(b.label);
}

function mergeWindows(payloads) {
  const best = new Map();
  for (const payload of payloads) {
    for (const row of readWindows(payload)) {
      best.set(row.key, preferReading(best.get(row.key), row));
    }
  }
  return Array.from(best.values()).sort(compareRows);
}

function describe(payload, capturedAtMs, nowMs) {
  return describeMany([{ payload, capturedAt: capturedAtMs }], nowMs);
}

function describeMany(readings, nowMs) {
  const payloads = readings.map((reading) => reading.payload);

  // A session that cannot see plan limits says so for itself, not for the
  // account, so one usable reading is enough to keep the panel populated.
  let available = false;
  for (const payload of payloads) {
    if (!payload || payload.rate_limits_available !== false) {
      available = true;
    }
  }
  if (payloads.length === 0) {
    available = true;
  }

  let capturedAt = 0;
  for (const reading of readings) {
    if (reading.capturedAt > capturedAt) {
      capturedAt = reading.capturedAt;
    }
  }

  // Pace tracks wall-clock even when the reading is old. The state files stop
  // being written because no session is running, which is also why usage is not
  // climbing, so the widening gap is real headroom rather than a stale artefact.
  const rows = mergeWindows(payloads).map(function (row) {
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

  return { available, capturedAt, rows };
}

module.exports = { describe, describeMany, MIN_PACE_FOR_PROJECTION };
