---
name: takode-cli-design
description: "Use when designing, changing, or reviewing Takode CLI commands, JSON output schemas, inspection commands, or orchestration command output that may expose session objects, prompts, histories, logs, recordings, images, tool results, artifacts, or other bulky/uncommon fields, or that shows agents long identifiers such as UUIDs and hashes."
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

## Common Case First

Do not make every row or message more verbose to support an occasional follow-up workflow. When a detail is only needed for navigation, debugging, or rare disambiguation, prefer an explicit lookup or reveal path over adding that detail to default rows.

Examples:
- Prefer `takode peek <session> --turn-containing <msg-id>` over printing a turn id on every `takode grep` result.
- Prefer a compact `threads:` line in `scan`/`peek` over default verbose per-thread status summaries.
- Keep rich status, marker, raw message, or provenance details available through `read`, JSON, `--details`, `--include`, or a targeted command when they are not needed for the common scanning task.

Before adding a default field to repeated rows, ask:
- Is this needed in most rows for the next decision?
- Would a user/model usually act on it immediately?
- Can the same workflow be served by a targeted command using an existing id?
- Does this field multiply token cost across long outputs?

If the field mainly supports a rare follow-up, do not include it by default. Add or improve the follow-up command instead.

## Opaque Identifiers

Do not show agents long opaque identifiers such as UUIDs, SHA-256 digests, full commit hashes or internal record IDs, in CLI output or in any text Takode builds for them, unless the agent needs that exact value for its next step: passing it to a command (`takode land status <entry-id>`), or checking it when it is the subject of the work (verifying a commit).

Why: an agent cannot interpret these values, and they cost tokens every time the text is read, often many times over (every row, every comment, every activity scan).

Instead, name what the agent can act on, such as a file path, session number, quest ID or short label, and keep exact identities in structured metadata, JSON or an explicit reveal path. Example: report comments once named the report UUID, session UUID and SHA-256 above every comment; they now name the report's source path once.

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
