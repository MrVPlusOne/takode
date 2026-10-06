# Using Takode with GitHub Copilot

Takode's Claude sessions can run on Claude models provided by a GitHub Copilot
subscription instead of an Anthropic account. Claude Code talks to Copilot's
Anthropic-compatible endpoint, and your GitHub sign-in supplies the
credentials.

With the settings below, the Claude model menu offers **Opus 5.5 (default),
Sonnet 5.5 and Haiku 4.5**, and each of them works through Copilot. These
models were tested with Claude Code 2.1.289 in October 2026.

## Requirements

- A GitHub Copilot plan with the Claude models enabled. Your plan or
  organization policy decides which models are available.
- The [GitHub CLI](https://cli.github.com) (`gh`), signed in to that account
  with `gh auth login`. If you're signed in to several accounts, Claude Code
  uses the active one; switch accounts with `gh auth switch`.
- [Claude Code](https://code.claude.com/docs) 2.1.289 or newer, as `claude` on
  your `PATH`.

## Setup

1. From the Takode repository root, run:

   ```bash
   ./scripts/setup-claude-copilot.sh
   ```

   This writes `~/.companion/claude-copilot/settings.json` and a launcher,
   `~/.companion/claude-copilot/claude-copilot`. If either file already exists
   and would change, the script first copies it to `<file>.bak-<timestamp>`.

2. In Takode, open **Settings → CLI & Backends** and set **Claude Code** to the
   launcher path the script printed.

3. Start a new Claude session. Sessions that are already running switch over
   when they relaunch.

The script changes nothing else: it doesn't touch your global Claude Code
settings, your plain `claude` command or Takode's server.

## What the settings do

The script installs [`scripts/claude-copilot-settings.json`](../scripts/claude-copilot-settings.json),
with `gh` replaced by its full path:

```json
{
  "model": "claude-opus-5.5",
  "apiKeyHelper": "gh auth token",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.githubcopilot.com",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-5.5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5.5",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "modelOverrides": {
    "claude-haiku-4-5": "claude-haiku-4.5"
  },
  "availableModels": ["opus", "sonnet", "haiku"]
}
```

- **`ANTHROPIC_BASE_URL` and `apiKeyHelper`** send requests to Copilot. Claude
  Code runs `gh auth token` whenever it needs a token, so the settings never
  contain a token.
- **Model IDs.** Copilot names models with dots (`claude-sonnet-5.5`), while
  Claude Code uses hyphens (`claude-sonnet-5-5`). The `ANTHROPIC_DEFAULT_*_MODEL`
  entries point the Opus and Sonnet aliases at Copilot's names.
- **Haiku uses `modelOverrides`.** Claude Code doesn't recognize a dotted ID
  such as `claude-haiku-4.5`, so for an env-pinned Haiku it guesses the model's
  features. It then sends a reasoning-effort setting that Haiku 4.5 rejects, and
  every Haiku request fails with `400 ... does not support reasoning effort`.
  `ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES` does not help, because
  Claude Code ignores it for this kind of endpoint. `modelOverrides` keeps
  Claude Code's knowledge of the real Haiku 4.5 while it sends Copilot's ID.
  Opus and Sonnet accept the effort setting, so pinning them through env works.
- **`availableModels`** removes Fable from the model list, because Copilot
  doesn't serve any Fable model. Takode builds its Claude model menu from the
  list Claude Code reports, so the menu shows only the three models.
- **`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`** stops Claude Code from
  contacting Anthropic directly for telemetry, error reporting and update
  checks.

The launcher also clears Anthropic credentials and other provider settings
from its environment, because they would override Copilot. When Takode asks
for streaming output, the launcher adds `--include-partial-messages` so Claude
Code reports progress while it writes a reply. Takode shows each reply once it
is complete, but uses this progress to tell a long reply from a stuck turn.

## Checking which models Copilot serves

Copilot's model list changes over time. To see the Claude models your account
can use:

```bash
printf 'Authorization: Bearer %s\n' "$(gh auth token)" |
  curl -sS -H @- https://api.githubcopilot.com/models |
  jq -r '.data[] | select(.id | startswith("claude")) | "\(.id)  \(.policy.state // "-")"'
```

The token goes to `curl` as a header through standard input, so it doesn't
show up in your shell history or process list. Models whose state isn't
`enabled` must be enabled in your Copilot settings before they work.

If a model's ID changes, update the matching entry in
`scripts/claude-copilot-settings.json` (or in your installed copy) and start a
new session.

## Undoing the setup

Clear the **Claude Code** field in Takode's settings, or set it back to your
previous value. To restore an earlier settings file or launcher, copy its
`.bak-<timestamp>` file back over it. Deleting `~/.companion/claude-copilot/`
removes the setup completely.
