---
name: takode-quest
description: Create and maintain documentation-focused Takode quest records when the user explicitly invokes this skill.
---

# Takode Quest

Use Takode quests as durable work records, not as an orchestration runtime. Codex goals and subagents own live execution.

- Inspect existing records with `quest_search` and `quest_show` before creating a likely duplicate.
- Use `quest_create` only when the user asks to create a quest.
- Add durable decisions, outcomes, evidence, and handoff context with `quest_add_note`.
- Use `quest_show` with `noteOffset` and `noteLimit` only when full historical note text is needed.
- Use `quest_edit` for content corrections. Use the dedicated claim, completion, and cancellation tools for lifecycle changes.
- Complete only with a self-contained final debrief and a concise debrief TLDR.
- Keep Takode and Codex session identifiers out of project-facing names and prose unless the record itself needs provenance.
