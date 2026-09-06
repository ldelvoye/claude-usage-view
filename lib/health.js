'use strict';

const FAILURES_BEFORE_WARNING = 3;

// Three outcomes are a resting state rather than a fault, and counting them
// would put a warning on the panel for people who have nothing wrong. A 401
// means the token expired, which happens precisely because Claude Code has not
// been running. A platform with no keychain was never going to have a token. And
// no credential at all is what an API key, Bedrock or Vertex user looks like:
// they have no plan limits to read, which is not a misconfiguration.
const NOT_A_FAULT = new Set(['unauthorized', 'unsupported', 'no-token']);

const WARNINGS = {
  unparseable: 'The usage endpoint returned something unexpected. Per-model rows are frozen at their last reading.',
  unreachable: 'Cannot reach the usage endpoint. Showing the last reading.',
  'bad-status': 'The usage endpoint refused the request. Showing the last reading.',
};

// Shown when there is nothing to display at all. Telling someone to run setup is
// only useful advice when setup would actually help them.
const EMPTY_REASONS = {
  'no-token': 'No Claude.ai plan credential found. API key, Bedrock and Vertex sessions have no plan limits to show.',
  unsupported: 'Reading limits directly needs macOS. Run Claude Usage: Show Setup to feed the panel from your status line instead.',
};

function initialHealth() {
  return { consecutive: 0, kind: null, resting: null, attempted: false };
}

function noteSuccess() {
  return { consecutive: 0, kind: null, resting: null, attempted: true };
}

function noteFailure(health, kind) {
  if (NOT_A_FAULT.has(kind)) {
    return { consecutive: health.consecutive, kind: health.kind, resting: kind, attempted: true };
  }
  return { consecutive: health.consecutive + 1, kind, resting: null, attempted: true };
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
  FAILURES_BEFORE_WARNING,
};
