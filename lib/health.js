'use strict';

const FAILURES_BEFORE_WARNING = 3;
const FETCH_INTERVAL_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;

// Three outcomes are a resting state rather than a fault, and counting them
// would put a warning on the panel for people who have nothing wrong. A 401
// means the token expired, which happens precisely because Claude Code has not
// been running. A platform with no keychain was never going to have a token. And
// no credential at all is what an API key, Bedrock or Vertex user looks like:
// they have no plan limits to read, which is not a misconfiguration.
// A rate limit joins them: it is transient, self-correcting, and warning about
// it would be telling the user about a condition the backoff already handles.
const NOT_A_FAULT = new Set(['unauthorized', 'unsupported', 'no-token', 'rate-limited']);

const WARNINGS = {
  unparseable: 'The usage endpoint returned something unexpected. Per-model rows are frozen at their last reading.',
  unreachable: 'Cannot reach the usage endpoint. Showing the last reading.',
  'bad-status': 'The usage endpoint refused the request. Showing the last reading.',
};

// Shown when there is nothing to display at all. Telling someone to run setup is
// only useful advice when setup would actually help them.
const EMPTY_REASONS = {
  'no-token': 'No Claude.ai plan credential found. API key, Bedrock and Vertex sessions have no plan limits to show.',
  unsupported: 'Reading limits directly needs macOS. Run Claude Usage: Show Status Line Setup to feed the panel from your status line instead.',
};

function initialHealth() {
  return { consecutive: 0, kind: null, resting: null, attempted: false, backoffSteps: 0 };
}

function noteSuccess() {
  return { consecutive: 0, kind: null, resting: null, attempted: true, backoffSteps: 0 };
}

// Two counters, because warning and backing off answer different questions. Only
// a genuine fault is worth telling the user about, but every failure is worth
// asking less often after, a rate limit above all.
function noteFailure(health, kind) {
  const backoffSteps = health.backoffSteps + 1;
  if (NOT_A_FAULT.has(kind)) {
    return {
      consecutive: health.consecutive,
      kind: health.kind,
      resting: kind,
      attempted: true,
      backoffSteps,
    };
  }
  return {
    consecutive: health.consecutive + 1,
    kind,
    resting: null,
    attempted: true,
    backoffSteps,
  };
}

function backoffFor(health) {
  if (!health || health.backoffSteps === 0) {
    return FETCH_INTERVAL_MS;
  }
  const doubled = FETCH_INTERVAL_MS * Math.pow(2, health.backoffSteps - 1);
  return Math.min(doubled, BACKOFF_MAX_MS);
}

// Every editor window activates its own copy of the extension, so a timer local
// to one process multiplies the request rate by however many windows happen to
// be open. Both gates read shared files instead: the data file records the last
// success, the attempt file the last try, so a failure holds the others off too.
function shouldFetch({ attemptAgeMs, dataAgeMs, health }) {
  if (attemptAgeMs < backoffFor(health)) {
    return false;
  }
  if (dataAgeMs < FETCH_INTERVAL_MS) {
    return false;
  }
  return true;
}

function warningFor(health) {
  if (!health || health.consecutive < FAILURES_BEFORE_WARNING) {
    return null;
  }
  return WARNINGS[health.kind] || null;
}

function emptyReasonFor(health) {
  if (!health || !health.resting) {
    return null;
  }
  return EMPTY_REASONS[health.resting] || null;
}

// Nothing has been asked of the endpoint yet, so an empty panel means "not
// finished starting up" rather than "nothing to show".
function isPending(health) {
  return Boolean(health) && !health.attempted;
}

module.exports = {
  initialHealth,
  isPending,
  noteSuccess,
  noteFailure,
  warningFor,
  emptyReasonFor,
  backoffFor,
  shouldFetch,
  FAILURES_BEFORE_WARNING,
  FETCH_INTERVAL_MS,
  BACKOFF_MAX_MS,
};
