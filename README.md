# Claude Usage

Your Claude Code plan limits as bars in the Explorer sidebar, with a marker for
where constant use would have put you by now.

```
Current session      50%
resets in 1h 24m     on track for 69%

All models           21%
resets Thu 5:00 AM   on track for 58%
```

Each bar carries three things: the solid fill is what you have used, the faint
band behind it runs to the point you would be at if you spread the window evenly,
and the line marks that point so it stays visible once the fill overtakes it. The
figure on the right extrapolates your current rate to the reset, which is the
number that actually answers "am I going to run out".

## Requirements

Claude Code on a Claude.ai plan. Sessions authenticated with an API key, or
running through Bedrock or Vertex, have no plan limits to show and the panel says
so instead of drawing empty bars.

## Setup

Plan-limit data is not queryable. Claude Code sends it to one place only: the
command configured as your status line. So this extension ships a small script
that sits in that position, records what it receives, and hands the same input
straight to whatever status line you already had.

Run **Claude Usage: Show Setup** from the command palette. It reads your current
configuration and prints the exact block for your machine. If you already have a
status line, it appears as the argument and keeps rendering unchanged:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/claude-usage-statusline.sh '~/.claude/statusline-command.sh'",
  "refreshInterval": 30
}
```

With no status line of your own, the argument is omitted and the shipped script
prints a short default line.

Add the block to `~/.claude/settings.json`. `refreshInterval` re-runs the status
line every N seconds on top of the usual event-driven updates, which is what
keeps the panel current while a session is open; drop it if you would rather it
only update when something happens.

## What it shows when nothing is running

Pace keeps advancing with the clock even when the reading is old. That is not a
stale number: the file stops updating because no session is running, which is the
same reason your usage is not climbing, so the growing gap is headroom you really
earned by being idle.

The exception is a window that has passed its own reset while you were away. That
reading describes a window which no longer exists, so the row reports the reset
and waits for a live figure rather than showing yesterday's percentage as if it
were current.

## Uninstalling

`~/.claude/claude-usage-statusline.sh` is left in place on purpose, so your status
line keeps working. To remove it fully, put the inner command back:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline-command.sh" }
```

then delete the script and `~/.claude/claude-usage/`.

## Building

No build step and no dependencies.

```sh
./package.sh          # writes claude-usage-view-<version>.vsix
node --test           # runs the suite
```

## Licence

MIT.
