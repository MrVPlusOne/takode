#!/usr/bin/env python3
"""Attach Codex task attribution to Takode MCP tool arguments."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from typing import Any

TAKODE_TOOL_NAMES = {
    "mcp__takode__quest_search",
    "mcp__takode__quest_show",
    "mcp__takode__quest_create",
    "mcp__takode__quest_edit",
    "mcp__takode__quest_add_note",
    "mcp__takode__quest_claim",
    "mcp__takode__quest_complete",
    "mcp__takode__quest_cancel",
    "mcp__takode__todo_list",
    "mcp__takode__todo_show",
    "mcp__takode__todo_create",
    "mcp__takode__todo_edit",
    "mcp__takode__todo_set_status",
    "mcp__takode__todo_archive",
    "mcp__takode__memory_recall",
    "mcp__takode__memory_read",
    "mcp__takode__lease_status",
}


def build_hook_output(
    payload: Mapping[str, Any],
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any] | None:
    """Build a PreToolUse rewrite, or skip when Takode already owns the session."""
    env = environment if environment is not None else os.environ
    if env.get("COMPANION_SESSION_ID") and env.get("COMPANION_AUTH_TOKEN"):
        return None

    tool_name = payload.get("tool_name")
    session_id = payload.get("session_id")
    tool_input = payload.get("tool_input")
    if tool_name not in TAKODE_TOOL_NAMES:
        return None
    if not isinstance(session_id, str) or not session_id.strip():
        return None
    if not isinstance(tool_input, Mapping):
        return None

    context = {"runtime": "codex", "sessionId": session_id.strip()}
    for source, target in (
        ("turn_id", "turnId"),
        ("tool_use_id", "toolUseId"),
        ("cwd", "cwd"),
    ):
        value = payload.get(source)
        if isinstance(value, str) and value.strip():
            context[target] = value.strip()

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**tool_input, "_takodeContext": context},
        }
    }


def main() -> None:
    """Read one hook event from stdin and emit its optional rewrite as JSON."""
    payload = json.load(sys.stdin)
    output = build_hook_output(payload)
    if output is not None:
        json.dump(output, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
