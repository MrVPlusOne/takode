#!/usr/bin/env python3
"""Attach Codex task attribution to Takode MCP tools and shell commands."""

from __future__ import annotations

import json
import os
import shlex
import sys
from collections.abc import Mapping
from typing import Any

TAKODE_MCP_TOOL_NAMES = {
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

CODEX_SHELL_ENVIRONMENT = (
    ("TAKODE_CODEX_SESSION_ID", "session_id"),
    ("TAKODE_CODEX_TURN_ID", "turn_id"),
    ("TAKODE_CODEX_TOOL_USE_ID", "tool_use_id"),
    ("TAKODE_CODEX_CWD", "cwd"),
)


def build_hook_output(
    payload: Mapping[str, Any],
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any] | None:
    """Build a PreToolUse identity rewrite unless Takode owns the session."""
    env = environment if environment is not None else os.environ
    if _has_takode_session_identity(env):
        return None

    tool_name = payload.get("tool_name")
    session_id = payload.get("session_id")
    tool_input = payload.get("tool_input")
    if not isinstance(session_id, str) or not session_id.strip():
        return None
    if not isinstance(tool_input, Mapping):
        return None

    if tool_name == "Bash":
        updated_input = _build_bash_input(payload, tool_input)
    elif tool_name in TAKODE_MCP_TOOL_NAMES:
        updated_input = _build_mcp_input(payload, tool_input, session_id.strip())
    else:
        return None
    if updated_input is None:
        return None

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated_input,
        }
    }


def main() -> None:
    """Read one hook event from stdin and emit its optional rewrite as JSON."""
    payload = json.load(sys.stdin)
    output = build_hook_output(payload)
    if output is not None:
        json.dump(output, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")


def _build_bash_input(
    payload: Mapping[str, Any],
    tool_input: Mapping[str, Any],
) -> dict[str, Any] | None:
    command = tool_input.get("command")
    if not isinstance(command, str):
        return None

    exports = " ".join(
        f"{environment_name}={shlex.quote(_payload_string(payload, payload_name))}"
        for environment_name, payload_name in CODEX_SHELL_ENVIRONMENT
    )
    return {**tool_input, "command": f"export {exports};\n{command}"}


def _build_mcp_input(
    payload: Mapping[str, Any],
    tool_input: Mapping[str, Any],
    session_id: str,
) -> dict[str, Any]:
    context = {"runtime": "codex", "sessionId": session_id}
    for source, target in (
        ("turn_id", "turnId"),
        ("tool_use_id", "toolUseId"),
        ("cwd", "cwd"),
    ):
        value = payload.get(source)
        if isinstance(value, str) and value.strip():
            context[target] = value.strip()

    return {**tool_input, "_takodeContext": context}


def _payload_string(payload: Mapping[str, Any], name: str) -> str:
    value = payload.get(name)
    return value if isinstance(value, str) else ""


def _has_takode_session_identity(environment: Mapping[str, str]) -> bool:
    return all(
        isinstance(environment.get(name), str) and bool(environment[name].strip())
        for name in ("COMPANION_SESSION_ID", "COMPANION_AUTH_TOKEN")
    )


if __name__ == "__main__":
    main()
