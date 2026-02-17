# Roadmap

Tracking ongoing work, planned features, and ideas for The Companion.

## In Progress

_Nothing currently in progress._

## Planned

- [ ] **Image & message lightbox** — Pasted images show as tiny thumbnails with no way to view them full-size. Clicking an image (in the composer or in chat history) should open a fullscreen/modal lightbox. Extend this to message chips as well — clicking a message chip should expand it into a larger, more readable view.
- [ ] **Sidebar session status indicators** — The sidebar session list doesn't clearly distinguish between idle and actively working sessions. Add a visual indicator (e.g. a pulsing dot, spinner, or color change) to each session card so it's obvious at a glance which sessions are busy (agent running/generating) vs idle (connected but waiting for input) vs disconnected.
- [ ] **Simplified permission model (plan/agent + permission toggle)** — Current plan mode is broken: after approving a plan, Claude Code switches to "default" mode which still prompts for basic edits. Redesign Companion to expose only two modes (Plan vs Agent) plus a per-session "ask permission" toggle. The mapping to Claude Code modes:
  - Plan + ask_permission=true → Claude plan mode, then after plan approval switch to yolo mode (no permission prompts at all)
  - Plan + ask_permission=false → Claude plan mode, then after plan approval switch to edit mode (no prompts for code changes)
  - Agent + ask_permission=true → Claude edit mode
  - Agent + ask_permission=false → Claude yolo mode
- [ ] **Copy Claude Code session ID from UI** — Add a button or menu option to easily copy the underlying Claude Code session ID for a Companion session. This allows resuming the session outside Companion (via `claude --resume <id>` in the CLI or the VSCode extension).
- [ ] **Remove auto-update checker** — The app has update-checking logic that polls for newer versions and shows prompts in the UI / server logs. Since this is a heavily modified personal fork, auto-update is unwanted. Remove all update-checking code (server-side checker, UI banner/prompts, any scheduled polling) entirely.

## Ideas

- [ ] **Collapsible agent activity between user messages** — In long conversations, scrolling past many tool calls and agent messages to find previous user messages is tedious. Add a toggle to collapse all agent activity between two consecutive user messages into a single compact row. When collapsed, show a brief indicator (e.g. "12 agent actions"). Bonus: call Claude Haiku to generate a short summary of the collapsed agent activity so users can skim what happened without expanding.
- [ ] **Investigate Claude Code hooks compatibility** — User hooks (configured in `~/.claude/settings.json` or `.claude/settings.json`) may not fire correctly when sessions run inside Companion. Investigate whether Companion or the CLI launcher modifies/overrides hook configuration. If Companion does inject its own hooks, ensure they are composed with the user's existing hooks (e.g. chained or merged) rather than replacing them.
- [ ] **Claude-Mem integration** — Connect the Claude-Mem observation database to the Companion UI. Claude-Mem runs an async worker that extracts learnings/summaries from each tool call. Once those observations are available, attach them to the corresponding tool call chips in the message stream. Users could expand a tool call to see what learnings were extracted from it (e.g. discoveries, decisions, bug findings). Requires querying the Claude-Mem API/DB and matching observations back to tool calls by session/timestamp.
