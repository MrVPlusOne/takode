---
name: takode-quest
description: Create and maintain documentation-focused Takode quest records when the user explicitly invokes this skill.
---

# Takode Quest

Use Takode quests as durable work records, not as an orchestration runtime. Codex goals and subagents own live execution.

The `quest` CLI is this plugin's sole Quest interface. Do not use or look for separate Takode Quest MCP tools.

- Prefer `quest` from `PATH`; use `~/.companion/bin/quest` only when it is unavailable.
- Inspect existing records with `quest grep <pattern>` and `quest show <exact-id>` before creating a likely duplicate. Never guess a quest ID.
- Use `quest create` only when the user asks to create a quest.
- Claim work with `quest claim <id>`, then keep the record current with `quest feedback add`, `quest edit`, and the appropriate lifecycle command.
- Let the plugin attach the current Codex task identity. Do not invent or manually pass a session ID.
- Prefer file flags such as `--desc-file`, `--text-file`, and `--debrief-file` for shell-sensitive or multiline text.
- Complete with `quest complete` only when the record includes a self-contained final debrief and concise debrief TLDR.
- Keep Takode and Codex session identifiers out of project-facing names and prose unless the record itself needs provenance.
