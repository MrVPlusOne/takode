import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexRuntimeDiagnosticsRoutes } from "./codex-runtime-diagnostics.js";
import type { RouteContext } from "./context.js";

const tempRoots: string[] = [];

async function createCodexRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-codex-runtime-route-"));
  tempRoots.push(root);
  return root;
}

async function writeRuntimeRollout(root: string, sessionId: string, threadId: string): Promise<void> {
  const day = join(root, sessionId, "sessions", "2026", "08", "14");
  await mkdir(day, { recursive: true });
  await writeFile(
    join(day, `rollout-2026-08-14T00-00-00-${threadId}.jsonl`),
    [
      JSON.stringify({
        timestamp: "2026-08-14T00:00:00.000Z",
        type: "session_meta",
        payload: { session_id: threadId, cli_version: "0.144.1" },
      }),
      JSON.stringify({
        timestamp: "2026-08-14T00:00:01.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-v2",
          multi_agent_version: "v2",
          multi_agent_mode: "proactive",
          effort: "ultra",
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );
}

function makeContext(session: Record<string, unknown>): RouteContext {
  return {
    resolveId: vi.fn(() => String(session.sessionId)),
    authenticateCompanionCallerOptional: vi.fn(() => null),
    launcher: { getSession: vi.fn(() => session) },
    wsBridge: { getSession: vi.fn(() => ({ backendType: session.backendType })) },
  } as unknown as RouteContext;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex runtime diagnostics route", () => {
  it("returns selected and retained effective multi-agent authority without raw rollout data", async () => {
    // The server route is the authority boundary consumed by `takode info`;
    // its compact payload must never expose rollout paths or raw turn context.
    const root = await createCodexRoot();
    const sessionId = "session-v2";
    const threadId = "thread-v2";
    await writeRuntimeRollout(root, sessionId, threadId);
    const api = createCodexRuntimeDiagnosticsRoutes(
      makeContext({
        sessionId,
        backendType: "codex",
        codexHome: root,
        cliSessionId: threadId,
        codexMultiAgentVersion: "v2",
      }),
    );

    const response = await api.request(`/sessions/${sessionId}/codex-runtime-diagnostics`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      codexMultiAgentVersion: "v2",
      codexEffectiveMultiAgentVersion: "v2",
      codexEffectiveMultiAgentMode: "proactive",
      codexEffectiveMultiAgentVersionReported: true,
      codexMultiAgentRuntimeDiagnostics: {
        source: "retained_rollout",
        status: "reported",
        sessionMetaMatched: true,
        cliVersion: "0.144.1",
        turnId: "turn-v2",
      },
    });
    expect(JSON.stringify(json)).not.toContain("rollout-2026");
    expect(json.codexMultiAgentRuntimeDiagnostics).not.toHaveProperty("path");
    expect(json.codexMultiAgentRuntimeDiagnostics).not.toHaveProperty("raw");
  });

  it("rejects invalid optional auth before reading retained runtime state", async () => {
    // Sessionless inspection is supported, but malformed credentials must keep
    // the same fail-closed behavior as the existing Takode info endpoint.
    const root = await createCodexRoot();
    const sessionId = "session-auth";
    const context = makeContext({
      sessionId,
      backendType: "codex",
      codexHome: root,
      cliSessionId: "thread-auth",
      codexMultiAgentVersion: "v2",
    });
    context.authenticateCompanionCallerOptional = vi.fn(() => ({
      response: Response.json({ error: "Invalid Companion auth" }, { status: 403 }),
    }));
    const api = createCodexRuntimeDiagnosticsRoutes(context);

    const response = await api.request(`/sessions/${sessionId}/codex-runtime-diagnostics`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid Companion auth" });
    expect(context.launcher.getSession).not.toHaveBeenCalled();
  });

  it("keeps selected V2 unverified before a CLI thread id exists", async () => {
    // A selected launch default is not effective evidence until Codex creates a
    // retained thread and turn context that can be matched back to the session.
    const root = await createCodexRoot();
    const sessionId = "session-pre-turn";
    const api = createCodexRuntimeDiagnosticsRoutes(
      makeContext({
        sessionId,
        backendType: "codex",
        codexHome: root,
        codexMultiAgentVersion: "v2",
      }),
    );

    const response = await api.request(`/sessions/${sessionId}/codex-runtime-diagnostics`);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      codexMultiAgentVersion: "v2",
      codexEffectiveMultiAgentVersion: null,
      codexEffectiveMultiAgentVersionReported: false,
      codexMultiAgentRuntimeDiagnostics: { status: "thread_id_missing" },
    });
  });
});
