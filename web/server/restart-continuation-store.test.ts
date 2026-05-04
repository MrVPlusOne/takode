import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRestartContinuationPlan,
  resumeRestartContinuations,
  saveRestartContinuationPlan,
} from "./restart-continuation-store.js";

describe("restart-continuation-store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "takode-restart-continuations-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drains a saved restart continuation plan and injects concise continue prompts once", async () => {
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
        message: "Continue.",
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
    expect(injectUserMessage).toHaveBeenCalledWith("worker-1", "Continue.", {
      sessionId: "system:restart-continuation:prep-1",
      sessionLabel: "System",
    });
    expect(injectUserMessage).toHaveBeenCalledWith("worker-2", "Continue.", {
      sessionId: "system:restart-continuation:prep-1",
      sessionLabel: "System",
    });
    await expect(access(join(tempDir, "restart-continuations.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const secondResult = await resumeRestartContinuations(tempDir, { injectUserMessage });
    expect(secondResult.plan).toBeNull();
    expect(injectUserMessage).toHaveBeenCalledTimes(2);
  });
});
