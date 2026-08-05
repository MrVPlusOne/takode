import { describe, expect, it, vi } from "vitest";
import { createCodexGoalRoutes } from "./session-codex-goal-routes.js";

function makeCtx(session: any) {
  return {
    resolveId: (raw: string) => (raw === "s1" ? "s1" : null),
    wsBridge: {
      getSession: vi.fn(() => session),
    },
  } as any;
}

describe("Codex Goal routes", () => {
  it("returns persisted Goal state without probing the backend", async () => {
    const goal = {
      threadId: "thread-1",
      objective: "Finish verification",
      status: "active",
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: 5,
      createdAt: null,
      updatedAt: null,
    };
    const app = createCodexGoalRoutes(
      makeCtx({
        backendType: "codex",
        state: { codex_goal: goal, codex_goal_capability: { state: "supported", checkedAt: 1, error: null } },
        codexAdapter: null,
      }),
    );

    const res = await app.request("/sessions/s1/codex-goal");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, goal: { objective: "Finish verification" } });
  });

  it("sets replace-mode objectives through the live Codex adapter", async () => {
    const setGoal = vi.fn(async () => ({ objective: "New objective", status: "active" }));
    const app = createCodexGoalRoutes(
      makeCtx({
        backendType: "codex",
        state: {},
        codexAdapter: { refreshGoal: vi.fn(), setGoal, clearGoal: vi.fn() },
      }),
    );

    const res = await app.request("/sessions/s1/codex-goal/set", {
      method: "POST",
      body: JSON.stringify({ objective: " New objective ", tokenBudget: 2500, mode: "replace" }),
    });

    expect(res.status).toBe(200);
    expect(setGoal).toHaveBeenCalledWith({ objective: "New objective", tokenBudget: 2500 }, "replace");
  });

  it("rejects Goal controls for non-Codex sessions", async () => {
    const app = createCodexGoalRoutes(makeCtx({ backendType: "claude", state: {}, codexAdapter: null }));

    const res = await app.request("/sessions/s1/codex-goal/refresh", { method: "POST" });

    expect(res.status).toBe(400);
  });
});
