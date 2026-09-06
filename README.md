# Claude Usage

Your Claude Code plan limits as bars in the Explorer sidebar, with a marker for where constant use would have put you by now.

```
Current session      62%
resets in 1h 30m     on track for 89%

All models           24%
resets Thu 5:00 AM   on track for 52%

Fable                30%
resets Thu 5:00 AM   on track for 65%
```


## Install

There is no marketplace listing. Build it yourself:

```sh
git clone https://github.com/ldelvoye/claude-usage-view.git
cd claude-usage-view
./package.sh
```

Then **Extensions → Install from VSIX**, pick the `.vsix` it wrote, and reload the window. There is nothing to configure.

Limits come from the same endpoint the `/usage` command uses, authenticated with the Claude Code credential in your keychain. Worth knowing before you install it: that means the extension reads your OAuth token and calls `api.anthropic.com`. It never refreshes or rewrites the token, Claude Code owns that, and it sends it nowhere else. `lib/usage-api.js` and the `readOauthToken` function in `extension.js` are the whole of it.

## What it needs

A Claude.ai subscription. Sessions authenticated with an API key, or running through Bedrock or Vertex, have no plan limits, and the panel says so rather than drawing empty bars.

Reading the credential needs macOS. On other platforms, wire the status line below and the panel works from that instead.

## Optional: feed it from your status line

Not required, and worth doing anyway.

The access token lives about four hours and is refreshed whenever Claude Code runs. Leave the editor open overnight without using Claude Code and it expires, at which point the panel carries on against its cached reading but stops learning anything new. A status line feed keeps a local copy that never expires, works offline, and works without a keychain.

Press **⌘⇧P** (**Ctrl+Shift+P** on Windows and Linux) and run **Claude Usage: Show Status Line Setup**. It reads your current configuration and opens the exact block for your machine. Anything you already have there is preserved as the argument and keeps rendering unchanged:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/claude-usage-statusline.sh '~/.claude/statusline-command.sh'",
  "refreshInterval": 30
}
```

Add it to `~/.claude/settings.json`. Nothing is ever written there on your behalf. `refreshInterval` re-runs the status line every N seconds on top of the usual event-driven updates; drop it if you would rather it only update when something happens.

The status line only carries the session and weekly windows. Per-model rows like Fable come from the endpoint alone.

## When readings stop

Pace keeps advancing with the clock even when the reading is old, and that is not a stale number: readings stop arriving because Claude Code is not running, which is the same reason your usage is not climbing. The growing gap is headroom you earned by being idle.

Two cases get their own treatment:

- **A window that has passed its own reset** describes a window that no longer exists, so the row reports the reset and waits for a live figure rather than showing yesterday's percentage as if it were current.
- **Three consecutive endpoint failures** raise a line under the rows naming what went wrong, cleared by a single success. An expired token is not counted: it is the normal overnight state, not a fault.

## Uninstalling

If you never wired the status line, uninstalling is enough.

If you did, `~/.claude/claude-usage-statusline.sh` is left in place on purpose so your status line keeps working. To remove it, put the inner command back:

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
