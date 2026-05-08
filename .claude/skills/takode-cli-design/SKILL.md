---
name: takode-cli-design
description: "Use when designing, changing, or reviewing Takode CLI commands, JSON output schemas, inspection commands, or orchestration command output that may expose session objects, prompts, histories, logs, recordings, images, tool results, artifacts, or other bulky/uncommon fields."
---

# Takode CLI Design

Use this skill before changing Takode CLI behavior or output shape.

## Core Rule

Default output is compact, operational, and enough for the next decision. Bulky, uncommon, debug, or raw fields require explicit reveal through a flag, field name, range, or detail command.

## Output Shape

- Plain text defaults should summarize what changed, identifiers needed for the next command, warnings, blockers, and concise status.
- JSON defaults should be compact and stable for scripts. JSON does not mean "dump every backend field".
- Expanded JSON is opt-in with `--details`, `--include <field>`, or a narrowly named detail command.
- Prefer progressive reveal: summary first, then `detail <id>`, `--full`, `--verbose`, `--details`, `--include <field>`, `--limit`, `--count`, or `--from` for deeper inspection.

## Bulky Fields

Do not include these by default:
- injected system prompts
- raw session objects or debug-only state
- full task/history/message payloads
- raw tool results, logs, recordings, images, screenshots, or artifact manifests
- large arrays when counts or summaries are enough

If a bulky field is useful, expose it by name and document the reveal path in help text.

## Design Checklist

- Classify each field as operational, uncommon detail, debug-only, or sensitive/secret-adjacent before adding it to default output.
- Keep compact output sufficient for safe orchestration: exact IDs, session numbers, quest IDs, affected rows, worker/reviewer state, wait/blocker state, and errors should remain visible.
- Add tests for compact defaults and explicit reveal paths whenever changing output that can contain bulky fields.
- Include at least one fixture with a large/debug field, such as `injectedSystemPrompt`, to prove default output omits it.
- Avoid solving context bloat only with UI truncation. Prevent unnecessary payloads at the command/output boundary first.

## Leader-Facing Guidance

Leader instructions should prefer compact plain output for judgment calls and routine dispatch. Use `--json` only for programmatic decisions, and use compact JSON before reaching for `--details` or `--include`.
