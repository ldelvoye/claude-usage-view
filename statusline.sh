#!/bin/sh
# Captures the plan-limit payload Claude Code pipes to a status line command,
# then hands the same input to the user's own status line ($1) if they set one.
# One file per session. Concurrent sessions report different bucket sets and can
# run different Claude Code versions, so a single shared file makes them fight
# over it and rows appear to vanish. The key is the session rather than the pid
# because this script is a fresh process on every render.
STATE_DIR="${CLAUDE_USAGE_DIR:-$HOME/.claude/claude-usage}"

input=$(cat)

# The character class doubles as sanitising: whatever lands here is a filename.
session=$(printf '%s' "$input" | sed -n 's/.*"session_id":"\([A-Za-z0-9_-]*\)".*/\1/p' | head -1)
if [ -z "$session" ]; then
  session="ppid-$PPID"
fi
STATE="$STATE_DIR/$session.json"

# rate_limits is absent before the session's first API response and after a
# window resets. Writing those renders would replace a good reading with an
# empty one. resets_at is the marker because it survives any spacing the
# serializer chooses around the colon.
case "$input" in
  *'"resets_at"'*)
    mkdir -p "$STATE_DIR" 2>/dev/null
    # Only the limits are read back. Keeping the rest would store this session's
    # paths and transcript location for as long as the file survives.
    if command -v jq > /dev/null 2>&1; then
      printf '%s' "$input" | jq -c '{rate_limits, rate_limits_available}' > "$STATE.tmp" 2>/dev/null
    else
      printf '%s' "$input" > "$STATE.tmp"
    fi
    if [ -s "$STATE.tmp" ]; then
      mv "$STATE.tmp" "$STATE"
    else
      rm -f "$STATE.tmp"
    fi
    ;;
esac

if [ -n "$1" ]; then
  printf '%s' "$input" | sh -c "$1"
  exit $?
fi

if command -v jq > /dev/null 2>&1; then
  printf '%s' "$input" | jq -r '
    .rate_limits as $r
    | [ (if $r.five_hour then "session \(($r.five_hour.utilization // $r.five_hour.used_percentage) | floor)%" else empty end),
        (if $r.seven_day then "week \(($r.seven_day.utilization // $r.seven_day.used_percentage) | floor)%" else empty end) ]
    | join(" · ")'
  exit 0
fi

printf '%s' "$PWD"
