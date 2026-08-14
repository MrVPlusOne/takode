import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexRolloutRuntimeDiagnostics } from "./codex-rollout-runtime-diagnostics.js";

const tempRoots: string[] = [];

async function createSessionHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-codex-runtime-diagnostics-"));
  tempRoots.push(root);
  return root;
}

async function writeRollout(
  sessionHome: string,
  threadId: string,
  records: string[],
  name = `rollout-2026-08-14T00-00-00-${threadId}.jsonl`,
): Promise<string> {
  const day = join(sessionHome, "sessions", "2026", "08", "14");
  await mkdir(day, { recursive: true });
  const path = join(day, name);
  await writeFile(path, records.join("\n"), "utf8");
  return path;
}

function sessionMeta(threadId: string, cliVersion = "0.144.1"): string {
  return JSON.stringify({
    timestamp: "2026-08-14T00:00:00.000Z",
    type: "session_meta",
    payload: { session_id: threadId, id: threadId, cli_version: cliVersion },
  });
}

function turnContext(options: {
  turnId: string;
  version?: string;
  mode?: string;
  effort?: string;
  timestamp?: string;
}): string {
  return JSON.stringify({
    timestamp: options.timestamp ?? "2026-08-14T00:00:01.000Z",
    type: "turn_context",
    payload: {
      turn_id: options.turnId,
      multi_agent_version: options.version ?? "v2",
      multi_agent_mode: options.mode ?? "proactive",
      effort: options.effort ?? "ultra",
    },
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readCodexRolloutRuntimeDiagnostics", () => {
  it("uses the latest complete turn_context from a matching retained session", async () => {
    // Runtime authority must follow the newest provider-authored context rather
    // than the selected launch flag or an older turn in the same rollout.
    const sessionHome = await createSessionHome();
    const threadId = "thread-latest";
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-old", version: "v1", mode: "explicitRequestOnly", effort: "high" }),
      JSON.stringify({ type: "response_item", payload: { large: "ignored" } }),
      turnContext({
        turnId: "turn-new",
        version: "v2",
        mode: "proactive",
        effort: "ultra",
        timestamp: "2026-08-14T00:00:02.000Z",
      }),
      "",
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result).toMatchObject({
      codexEffectiveMultiAgentVersion: "v2",
      codexEffectiveMultiAgentMode: "proactive",
      codexEffectiveMultiAgentVersionReported: true,
      codexMultiAgentRuntimeDiagnostics: {
        source: "retained_rollout",
        status: "reported",
        sessionMetaMatched: true,
        cliVersion: "0.144.1",
        turnId: "turn-new",
        observedAt: Date.parse("2026-08-14T00:00:02.000Z"),
      },
    });
  });

  it("rejects a rollout whose session_meta does not match the requested thread", async () => {
    // A filename suffix is not sufficient authority because copied or corrupt
    // rollouts could otherwise report another thread's effective version.
    const sessionHome = await createSessionHome();
    const threadId = "thread-requested";
    await writeRollout(sessionHome, threadId, [sessionMeta("thread-other"), turnContext({ turnId: "turn-1" }), ""]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics.status).toBe("session_meta_mismatch");
    expect(result.codexMultiAgentRuntimeDiagnostics.sessionMetaMatched).toBe(false);
  });

  it("ignores a partial trailing context and retains the latest complete runtime evidence", async () => {
    // Codex appends JSONL while a turn runs, so a concurrent read may observe a
    // truncated last line; it must never promote partial data to authority.
    const sessionHome = await createSessionHome();
    const threadId = "thread-partial";
    const partial = '{"timestamp":"2026-08-14T00:00:03.000Z","type":"turn_context","payload":{"turn_id":"turn-partial"';
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-complete", version: "v1", mode: "explicitRequestOnly", effort: "high" }),
      partial,
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result).toMatchObject({
      codexEffectiveMultiAgentVersion: "v1",
      codexEffectiveMultiAgentMode: "explicitRequestOnly",
      codexEffectiveMultiAgentVersionReported: true,
      codexMultiAgentRuntimeDiagnostics: { turnId: "turn-complete" },
    });
  });

  it("fails closed when the latest complete turn_context is structurally invalid", async () => {
    // Falling back to an older valid context would make stale V1/V2 evidence
    // look current after protocol drift or rollout corruption.
    const sessionHome = await createSessionHome();
    const threadId = "thread-invalid";
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-old", version: "v1" }),
      turnContext({ turnId: "turn-invalid", version: "future" }),
      "",
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics).toMatchObject({
      status: "turn_context_invalid",
      sessionMetaMatched: true,
      turnId: "turn-invalid",
    });
  });

  it("fails closed when the latest turn_context omits its payload", async () => {
    // A syntactically valid but incomplete provider record is still the latest
    // context and must not silently fall back to stale older V1/V2 evidence.
    const sessionHome = await createSessionHome();
    const threadId = "thread-missing-payload";
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-old", version: "v1" }),
      JSON.stringify({ type: "turn_context", timestamp: "2026-08-14T00:00:03.000Z" }),
      "",
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics.status).toBe("turn_context_invalid");
  });

  it("fails closed on a malformed complete turn_context line", async () => {
    // A malformed provider record that is fully terminated is different from a
    // concurrent partial append and must not fall back to older stale proof.
    const sessionHome = await createSessionHome();
    const threadId = "thread-malformed";
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-old", version: "v1" }),
      '{"type":"turn_context","payload":{"turn_id":"turn-bad",}',
      "",
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics.status).toBe("turn_context_invalid");
  });

  it("reports missing runtime evidence without inferring from selected configuration", async () => {
    // A freshly initialized thread can have session_meta before its first turn;
    // selected V2 alone must not be presented as an effective runtime report.
    const sessionHome = await createSessionHome();
    const threadId = "thread-no-turn";
    await writeRollout(sessionHome, threadId, [sessionMeta(threadId), ""]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result).toMatchObject({
      codexEffectiveMultiAgentVersion: null,
      codexEffectiveMultiAgentMode: null,
      codexEffectiveMultiAgentVersionReported: false,
      codexMultiAgentRuntimeDiagnostics: {
        status: "turn_context_missing",
        sessionMetaMatched: true,
      },
    });
  });

  it("returns an explicit bounded-scan status when later output hides the last context", async () => {
    // The diagnostic reader deliberately caps I/O; a very large current turn
    // must become unknown rather than triggering an unbounded server read.
    const sessionHome = await createSessionHome();
    const threadId = "thread-large-tail";
    const oversizedOutput = JSON.stringify({ type: "response_item", payload: { text: "x".repeat(8 * 1024 * 1024) } });
    await writeRollout(sessionHome, threadId, [
      sessionMeta(threadId),
      turnContext({ turnId: "turn-before-large-output" }),
      oversizedOutput,
      "",
    ]);

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics).toMatchObject({
      status: "turn_context_outside_scan_window",
      sessionMetaMatched: true,
      scanTruncated: true,
    });
  });

  it("uses the newest matching rollout file for a resumed thread", async () => {
    // Resumes can leave more than one retained rollout candidate; the newest
    // file is the effective provider history that inspection should report.
    const sessionHome = await createSessionHome();
    const threadId = "thread-resumed";
    const older = await writeRollout(
      sessionHome,
      threadId,
      [sessionMeta(threadId), turnContext({ turnId: "turn-old", version: "v1" }), ""],
      `rollout-2026-08-14T00-00-00-${threadId}.jsonl`,
    );
    const newer = await writeRollout(
      sessionHome,
      threadId,
      [sessionMeta(threadId, "0.145.0"), turnContext({ turnId: "turn-new", version: "v2" }), ""],
      `rollout-2026-08-14T00-01-00-${threadId}.jsonl`,
    );
    await utimes(older, new Date(1_000), new Date(1_000));
    await utimes(newer, new Date(2_000), new Date(2_000));

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId);

    expect(result).toMatchObject({
      codexEffectiveMultiAgentVersion: "v2",
      codexMultiAgentRuntimeDiagnostics: { cliVersion: "0.145.0", turnId: "turn-new" },
    });
  });

  it("fails closed when newest-first rollout discovery reaches its directory bound", async () => {
    // Diagnostics run during startup reconciliation for every worker. An old
    // target hidden behind too many newer retained rollout days must become an
    // explicit unknown state instead of triggering an unbounded directory walk.
    const sessionHome = await createSessionHome();
    const threadId = "thread-outside-discovery-bound";
    await writeRollout(sessionHome, threadId, [sessionMeta(threadId), turnContext({ turnId: "turn-old" }), ""]);
    const newerDay = join(sessionHome, "sessions", "2026", "08", "15");
    await mkdir(newerDay, { recursive: true });
    await writeFile(
      join(newerDay, "rollout-2026-08-15T00-00-00-other-thread.jsonl"),
      [sessionMeta("other-thread"), turnContext({ turnId: "turn-newer" }), ""].join("\n"),
      "utf8",
    );

    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, threadId, {
      discoveryLimits: { maxDayDirectories: 1 },
    });

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics.status).toBe("rollout_discovery_truncated");
  });

  it("reports a missing rollout as unverified", async () => {
    // Missing retained state must remain distinguishable from disabled or V1.
    const sessionHome = await createSessionHome();
    const result = await readCodexRolloutRuntimeDiagnostics(sessionHome, "thread-missing");

    expect(result.codexEffectiveMultiAgentVersionReported).toBe(false);
    expect(result.codexMultiAgentRuntimeDiagnostics.status).toBe("rollout_not_found");
  });
});
