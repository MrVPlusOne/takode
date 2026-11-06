import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRestartContinuationPlan,
  HOST_UPDATE_REQUEST_MAX_AGE_MS,
  RESTART_CONTINUE_MESSAGE,
  resumeAfterLeftoverProcess,
  resumeRestartContinuations,
  saveHostUpdateRequest,
  saveRestartContinuationPlan,
  sendRestartContinuation,
  takeHostUpdateRequest,
} from "./restart-continuation-store.js";

describe("restart-continuation-store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "takode-restart-continuations-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drains a saved restart continuation plan and injects concise continue prompts once without catalog preload", async () => {
    const plan = buildRestartContinuationPlan({
      operationId: "prep-1",
      now: 123,
      sessions: [
        { sessionId: "worker-1", label: "Worker one" },
        { sessionId: "worker-1", label: "Worker duplicate" },
        { sessionId: "worker-2", label: "Worker two" },
      ],
    });
    await saveRestartContinuationPlan(tempDir, plan);

    const injectUserMessage = vi.fn((sessionId: string) => (sessionId === "worker-1" ? "queued" : "sent"));
    const result = await resumeRestartContinuations(tempDir, { injectUserMessage });

    expect(result).toMatchObject({
      plan: {
        operationId: "prep-1",
        sessions: [
          { sessionId: "worker-1", label: "Worker one" },
          { sessionId: "worker-2", label: "Worker two" },
        ],
      },
      sent: 1,
      queued: 1,
      dropped: 0,
      noSession: 0,
    });
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-1",
      RESTART_CONTINUE_MESSAGE,
      {
        sessionId: "system:restart-continuation:prep-1",
        sessionLabel: "System",
      },
      undefined,
      undefined,
      expect.objectContaining({
        deliveryContent: RESTART_CONTINUE_MESSAGE,
        historyFollowUps: [],
      }),
    );
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-2",
      RESTART_CONTINUE_MESSAGE,
      {
        sessionId: "system:restart-continuation:prep-1",
        sessionLabel: "System",
      },
      undefined,
      undefined,
      expect.objectContaining({
        deliveryContent: RESTART_CONTINUE_MESSAGE,
        historyFollowUps: [],
      }),
    );
    await expect(access(join(tempDir, "restart-continuations.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const secondResult = await resumeRestartContinuations(tempDir, { injectUserMessage });
    expect(secondResult.plan).toBeNull();
    expect(injectUserMessage).toHaveBeenCalledTimes(2);
  });

  // The server that restarts saves the plan, and the server it starts sends
  // the continuations. A plan saved by an older server still carries that
  // server's message, which must not replace the current one: otherwise the
  // first restart onto a build with new wording would still send the old text.
  it("sends the current continuation for a plan saved with an older message", async () => {
    await writeFile(
      join(tempDir, "restart-continuations.json"),
      JSON.stringify({
        version: 1,
        operationId: "prep-old",
        createdAt: 1_000,
        message: "Old continuation wording.",
        sessions: [{ sessionId: "worker-1", label: "Worker one" }],
      }),
      "utf-8",
    );

    const injectUserMessage = vi.fn(() => "sent" as const);
    const result = await resumeRestartContinuations(tempDir, { injectUserMessage });

    expect(result.sent).toBe(1);
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-1",
      RESTART_CONTINUE_MESSAGE,
      { sessionId: "system:restart-continuation:prep-old", sessionLabel: "System" },
      undefined,
      undefined,
      { deliveryContent: RESTART_CONTINUE_MESSAGE, historyFollowUps: [] },
    );
  });

  // Restart Server leaves a request for the server it starts to update hosts
  // right away. It is read once, and a stale one (say from a restart that
  // failed, followed much later by a start by hand) is no user's restart.
  it("hands a Restart Server request for host updates to the next server once", async () => {
    expect(await takeHostUpdateRequest(tempDir, 5_000)).toBe(false);

    await saveHostUpdateRequest(tempDir, 1_000);
    expect(await takeHostUpdateRequest(tempDir, 5_000)).toBe(true);
    expect(await takeHostUpdateRequest(tempDir, 5_000)).toBe(false);

    await saveHostUpdateRequest(tempDir, 1_000);
    expect(await takeHostUpdateRequest(tempDir, 1_000 + HOST_UPDATE_REQUEST_MAX_AGE_MS + 1)).toBe(false);
    await expect(access(join(tempDir, "restart-host-updates.json"))).rejects.toThrow();
  });

  // Turns a host update interrupts continue with the same message and source
  // as a restart continuation.
  it("sends a single restart continuation", () => {
    const injectUserMessage = vi.fn(() => "sent" as const);
    expect(sendRestartContinuation({ injectUserMessage }, "worker-1", "host-update:h1:abc")).toBe("sent");
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-1",
      RESTART_CONTINUE_MESSAGE,
      { sessionId: "system:restart-continuation:host-update:h1:abc", sessionLabel: "System" },
      undefined,
      undefined,
      { deliveryContent: RESTART_CONTINUE_MESSAGE, historyFollowUps: [] },
    );
  });

  // Restart Server leaves node-run sessions running mid-turn. When the restarted
  // server builds other instructions it ends those processes instead of taking
  // them over, and the restored session does not know a turn was under way. In
  // the reported case a worker's turn was cut off this way: no turn end reached
  // its leader, and the session sat "running" in its history until someone looked.
  describe("resumeAfterLeftoverProcess", () => {
    const idleSession = (overrides: Partial<Parameters<typeof resumeAfterLeftoverProcess>[0]> = {}) => ({
      backendType: "claude-sdk",
      messageHistory: [{ type: "user_message" }, { type: "assistant" }, { type: "result" }],
      isGenerating: false,
      pendingMessages: [],
      pendingCodexInputs: [],
      pendingCodexTurns: [],
      ...overrides,
    });
    const run = (session: Parameters<typeof resumeAfterLeftoverProcess>[0]) => {
      const actions = { continueTurn: vi.fn(), relaunch: vi.fn() };
      return { outcome: resumeAfterLeftoverProcess(session, actions), ...actions };
    };

    it("continues a Claude turn the ending cut off", () => {
      // A leader's message arrived mid-turn, then the agent kept working (tool output
      // and assistant text are trailing entries) until its process was ended.
      for (const tail of [
        [{ type: "user_message" }, { type: "assistant" }, { type: "tool_result_preview" }],
        // A turn the CLI started itself (a background job's completion notice) has no user message.
        [{ type: "assistant" }],
      ]) {
        const { outcome, continueTurn, relaunch } = run(
          idleSession({ messageHistory: [{ type: "user_message" }, { type: "result" }, ...tail] }),
        );
        expect(outcome).toBe("continued");
        expect(continueTurn).toHaveBeenCalledTimes(1);
        expect(relaunch).not.toHaveBeenCalled();
      }
    });

    it("leaves an idle session stopped until its next message", () => {
      // Entries after the result that are not turn input or output do not reopen the turn.
      const { outcome, continueTurn, relaunch } = run(
        idleSession({ messageHistory: [{ type: "user_message" }, { type: "result" }, { type: "compact_marker" }] }),
      );
      expect(outcome).toBeNull();
      expect(continueTurn).not.toHaveBeenCalled();
      expect(relaunch).not.toHaveBeenCalled();
      expect(run(idleSession({ messageHistory: [] })).outcome).toBeNull();
    });

    it("relaunches a session whose input waited for its host", () => {
      const { outcome, relaunch, continueTurn } = run(idleSession({ pendingMessages: ["herd event"] }));
      expect(outcome).toBe("relaunched");
      expect(relaunch).toHaveBeenCalledTimes(1);
      expect(continueTurn).not.toHaveBeenCalled();
    });

    // Input queued while the session waited for its node is in its history already. It
    // started no turn, so only the turn before it decides whether a continuation is needed:
    // a session Restart Server interrupted, then queued its continuation for, only relaunches
    // to deliver it, while a cut-off turn with a herd event queued after it is still continued.
    it("judges the turn before input that waits for delivery", () => {
      const interrupted = run(
        idleSession({
          messageHistory: [{ type: "user_message" }, { type: "result" }, { type: "user_message" }],
          pendingMessages: ["restart continuation"],
        }),
      );
      expect(interrupted.outcome).toBe("relaunched");
      expect(interrupted.continueTurn).not.toHaveBeenCalled();

      const cutOff = run(
        idleSession({
          messageHistory: [{ type: "user_message" }, { type: "assistant" }, { type: "user_message" }],
          pendingMessages: ["herd event"],
        }),
      );
      expect(cutOff.outcome).toBe("continued");
    });

    it("relaunches Codex for its unfinished turns, which it resumes itself", () => {
      // Codex persists its turns, so a continuation message would duplicate the resumed turn.
      const codex = (pendingCodexTurns: Array<{ status?: string }>) =>
        idleSession({ backendType: "codex", messageHistory: [{ type: "user_message" }], pendingCodexTurns });
      const unfinished = run(codex([{ status: "dispatched" }]));
      expect(unfinished.outcome).toBe("relaunched");
      expect(unfinished.continueTurn).not.toHaveBeenCalled();
      expect(run(codex([{ status: "completed" }])).outcome).toBeNull();
    });
  });
});
