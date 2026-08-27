import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER } from "../server/routes/auth.js";
import { callTakodeIntegration, registerTakodeSidecarTools } from "./takode-sidecar-mcp.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const identityHook = resolve(repoRoot, "plugins/takode/hooks/inject_identity.py");
const hooksConfig = resolve(repoRoot, "plugins/takode/hooks/hooks.json");
const tempRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function sidecarEnvironment(port = 4567): Promise<Record<string, string>> {
  const home = await mkdtemp(resolve(tmpdir(), "takode-sidecar-mcp-"));
  tempRoots.push(home);
  const integrationsDir = resolve(home, ".companion/integrations");
  await mkdir(integrationsDir, { recursive: true });
  await writeFile(
    resolve(integrationsDir, `codex-sidecar-${port}.json`),
    JSON.stringify({
      version: 1,
      baseUrl: `http://127.0.0.1:${port}/api/integrations/codex`,
      capability: "capability-value",
      port,
      serverId: "server-test",
    }),
  );
  return { HOME: home, TAKODE_API_PORT: String(port) };
}

describe("Takode sidecar MCP bridge", () => {
  it("registers only focused sidecar data tools", () => {
    // The plugin intentionally excludes session control and Takode orchestration.
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => {
        names.push(name);
      }),
    };

    registerTakodeSidecarTools(server as never);

    expect(names).toEqual([
      "todo_list",
      "todo_show",
      "todo_create",
      "todo_edit",
      "todo_set_status",
      "todo_archive",
      "memory_recall",
      "memory_read",
      "lease_status",
    ]);
  });

  it("adds hook-provided Codex attribution to writes", async () => {
    // Ordinary Codex tasks have no Companion credentials; the hook context is
    // attribution only and is forwarded through the additive integration API.
    const fetchMock = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/bind")
        ? Response.json({ binding: { id: "binding-1", expiresAt: Date.now() + 60_000 } })
        : Response.json({ item: { id: "todo-7" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const environment = await sidecarEnvironment();

    const result = await callTakodeIntegration({
      method: "POST",
      path: "/todos",
      body: { markdown: "Review the migration notes" },
      context: {
        runtime: "codex",
        sessionId: "codex-session",
        turnId: "turn-1",
        toolUseId: "tool-1",
        cwd: "/repo",
      },
      requireIdentity: true,
      environment,
    });

    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [bindUrl, bindInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(bindUrl.toString()).toBe("http://127.0.0.1:4567/api/integrations/codex/bind");
    expect(bindInit.headers).toMatchObject({ "x-takode-sidecar-capability": "capability-value" });
    const [url, init] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4567/api/integrations/codex/todos");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "x-takode-sidecar-capability": "capability-value",
      "x-takode-sidecar-binding": "binding-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      markdown: "Review the migration notes",
      actor: {
        kind: "codex_session",
        sessionId: "codex-session",
        turnId: "turn-1",
        toolUseId: "tool-1",
        cwd: "/repo",
      },
    });
  });

  it("keeps Companion credentials authoritative in Takode-managed sessions", async () => {
    // A globally enabled plugin can be inherited by isolated Takode Codex homes.
    // Existing Takode session identity must win over injected Codex context.
    const fetchMock = vi.fn(async () => Response.json({ item: { id: "todo-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const environment = await sidecarEnvironment(3456);

    await callTakodeIntegration({
      method: "POST",
      path: "/todos",
      body: { markdown: "Review notes" },
      context: { runtime: "codex", sessionId: "wrong-codex-session" },
      requireIdentity: true,
      environment: {
        ...environment,
        TAKODE_API_PORT: "4567",
        COMPANION_PORT: "3456",
        COMPANION_SESSION_ID: "takode-session",
        COMPANION_AUTH_TOKEN: "secret-token",
      },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect((fetchMock.mock.calls[0] as unknown as [URL])[0].toString()).toBe(
      "http://127.0.0.1:3456/api/integrations/codex/todos",
    );
    expect(init.headers).toMatchObject({
      [COMPANION_SESSION_ID_HEADER]: "takode-session",
      [COMPANION_AUTH_TOKEN_HEADER]: "secret-token",
    });
    expect(JSON.parse(String(init.body)).actor).toEqual({
      kind: "takode_session",
      sessionId: "takode-session",
    });
  });

  it("allows anonymous reads but fails writes before network access", async () => {
    // Missing hook trust should not hide read-only data, but anonymous mutations
    // would lose the provenance required by Todo records.
    const fetchMock = vi.fn(async () => Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const environment = await sidecarEnvironment();

    const read = await callTakodeIntegration({ path: "/todos", environment });
    const write = await callTakodeIntegration({
      method: "POST",
      path: "/todos",
      body: { markdown: "Anonymous" },
      requireIdentity: true,
      environment,
    });

    expect(read.isError).toBeUndefined();
    expect(write.isError).toBe(true);
    expect(write.content[0]?.text).toContain("identity is unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Takode plugin identity hook", () => {
  function runHook(input: Record<string, unknown>, environment: Record<string, string> = {}) {
    return spawnSync("python3", [identityHook], {
      input: JSON.stringify(input),
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", ...environment },
    });
  }

  it("declares Bash and only the remaining MCP sidecar tools", async () => {
    const config = JSON.parse(await readFile(hooksConfig, "utf-8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };

    expect(config.hooks.PreToolUse.map(({ matcher }) => matcher)).toEqual([
      "^mcp__takode__(todo_list|todo_show|todo_create|todo_edit|todo_set_status|todo_archive|memory_recall|memory_read|lease_status)$",
      "^Bash$",
    ]);
  });

  it("overwrites model-supplied MCP context while preserving tool arguments", () => {
    // PreToolUse is the only documented per-call bridge from Codex task identity
    // into stdio MCP arguments, so the reserved field must never trust the model.
    const result = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__takode__todo_create",
      session_id: "codex-session",
      turn_id: "turn-1",
      tool_use_id: "tool-1",
      cwd: "/repo",
      tool_input: {
        markdown: "Keep this",
        _takodeContext: { runtime: "codex", sessionId: "spoofed" },
      },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      markdown: "Keep this",
      _takodeContext: {
        runtime: "codex",
        sessionId: "codex-session",
        turnId: "turn-1",
        toolUseId: "tool-1",
        cwd: "/repo",
      },
    });
  });

  it("safely exports Codex identity for Bash without changing command behavior", () => {
    const identity = {
      sessionId: "codex session'; printf injected",
      turnId: "turn $(printf injected)",
      toolUseId: "tool\nline",
      cwd: "/repo/quoted ' path",
    };
    const command =
      'printf \'%s\\0\' "$TAKODE_CODEX_SESSION_ID" "$TAKODE_CODEX_TURN_ID" "$TAKODE_CODEX_TOOL_USE_ID" "$TAKODE_CODEX_CWD"; exit 7';
    const result = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      session_id: identity.sessionId,
      turn_id: identity.turnId,
      tool_use_id: identity.toolUseId,
      cwd: identity.cwd,
      tool_input: { command, yield_time_ms: 250, max_output_chars: 1024 },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    const updatedInput = output.hookSpecificOutput.updatedInput as {
      command: string;
      yield_time_ms: number;
      max_output_chars: number;
    };
    expect(updatedInput).toMatchObject({ yield_time_ms: 250, max_output_chars: 1024 });
    expect(updatedInput.command).toContain(`\n${command}`);

    const execution = spawnSync("/bin/bash", ["-c", updatedInput.command], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(execution.status).toBe(7);
    expect(execution.stdout.split("\0")).toEqual([
      identity.sessionId,
      identity.turnId,
      identity.toolUseId,
      identity.cwd,
      "",
    ]);
  });

  it("emits no rewrite when Takode already supplied complete session credentials", () => {
    // This is the compatibility boundary for sessions launched and managed by Takode.
    const result = runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        session_id: "codex-thread",
        tool_input: { command: "quest show q-7", yield_time_ms: 250 },
      },
      {
        COMPANION_SESSION_ID: "takode-session",
        COMPANION_AUTH_TOKEN: "secret-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("keeps injecting Bash identity when Takode credentials are incomplete", () => {
    for (const environment of [{ COMPANION_SESSION_ID: "takode-session" }, { COMPANION_AUTH_TOKEN: "secret-token" }]) {
      const result = runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "codex-thread",
          tool_input: { command: "quest list" },
        },
        environment,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput.command).toContain(
        "TAKODE_CODEX_SESSION_ID=codex-thread",
      );
    }
  });

  it("does not rewrite retired Quest MCP tools", () => {
    const result = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__takode__quest_show",
      session_id: "codex-thread",
      tool_input: { questId: "q-7" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not rewrite the existing Takode delegate tool", () => {
    // The plugin hook must not intercept Takode's separately managed delegation MCP.
    const result = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__takode_delegate__takode_delegate",
      session_id: "codex-thread",
      tool_input: { task: "Inspect this" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
