---
name: takode-memory
description: Read curated Takode memory when prior decisions or durable project knowledge may help. Uses the `memory` CLI catalog and folder listings.
---

# Takode Memory

Read Takode memory the same way Takode sessions do, through the `memory` CLI (prefer `memory` from `PATH`; use `~/.companion/bin/memory` only when it is unavailable). If the `memory` skill is installed, follow it; it is the full workflow.

1. Run `memory catalog show`. It lists the recently updated notes plus one line per topic folder.
2. Before relying on memory for a task, list every folder whose description matches it with `memory catalog show <folder>`, and read the relevant notes, not just the first match. Each output ends with a memory handle; pass the newest one with `--seen <handle>` to skip entries already shown, or omit `--seen` for the full output.
3. Read notes as files under `$(memory repo path)`, or with the `memory_read` tool when file access is unavailable. Use `rg` there for exact terms.

Treat notes as curated context, not automatically current truth; verify drift-prone facts when practical. This plugin does not write memory; do not claim that memory was updated through it.
