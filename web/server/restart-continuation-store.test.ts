import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRestartContinuationPlan,
  HOST_UPDATE_REQUEST_MAX_AGE_MS,
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
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-1",
      "Continue.",
      {
        sessionId: "system:restart-continuation:prep-1",
        sessionLabel: "System",
      },
      undefined,
      undefined,
      expect.objectContaining({
        deliveryContent: "Continue.",
        historyFollowUps: [],
      }),
    );
    expect(injectUserMessage).toHaveBeenCalledWith(
      "worker-2",
      "Continue.",
      {
        sessionId: "system:restart-continuation:prep-1",
        sessionLabel: "System",
      },
      undefined,
      undefined,
      expect.objectContaining({
        deliveryContent: "Continue.",
        historyFollowUps: [],
      }),
    );
    await expect(access(join(tempDir, "restart-continuations.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const secondResult = await resumeRestartContinuations(tempDir, { injectUserMessage });
    expect(secondResult.plan).toBeNull();
    expect(injectUserMessage).toHaveBeenCalledTimes(2);
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
      "Continue.",
      { sessionId: "system:restart-continuation:host-update:h1:abc", sessionLabel: "System" },
      undefined,
      undefined,
      { deliveryContent: "Continue.", historyFollowUps: [] },
    );
  });
});
