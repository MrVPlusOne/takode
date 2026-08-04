import { describe, expect, it, vi } from "vitest";
import { runPreListenStartupReadiness } from "./startup-readiness.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runPreListenStartupReadiness", () => {
  it("finishes phase seeding and skill symlinks before listener/session adoption work can continue", async () => {
    const order: string[] = [];
    const skillReady = deferred();
    const readiness = runPreListenStartupReadiness(
      {
        ensureQuestmasterIntegration: vi.fn(async () => {
          order.push("quest");
        }) as never,
        ensureTakodeIntegration: vi.fn(async () => {
          order.push("takode");
        }) as never,
        ensureBuiltInQuestJourneyPhaseData: vi.fn(async () => {
          order.push("phases");
        }) as never,
        ensureSkillSymlinks: vi.fn(async () => {
          order.push("skills-start");
          await skillReady.promise;
          order.push("skills-done");
        }) as never,
      },
      { port: 3456, packageRoot: "/repo/web", startupSkillSlugs: ["takode-orchestration"] },
    ).then(() => {
      order.push("listener");
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["quest", "takode", "phases", "skills-start"]);

    skillReady.resolve();
    await readiness;
    expect(order).toEqual(["quest", "takode", "phases", "skills-start", "skills-done", "listener"]);
  });

  it("fails closed before listener/session adoption when phase seeding fails", async () => {
    const listener = vi.fn();

    await expect(
      runPreListenStartupReadiness(
        {
          ensureQuestmasterIntegration: vi.fn(async () => undefined) as never,
          ensureTakodeIntegration: vi.fn(async () => undefined) as never,
          ensureBuiltInQuestJourneyPhaseData: vi.fn(async () => {
            throw new Error("phase seed failed");
          }) as never,
          ensureSkillSymlinks: vi.fn(async () => {
            listener();
          }) as never,
        },
        { port: 3456, packageRoot: "/repo/web", startupSkillSlugs: ["takode-orchestration"] },
      ).then(listener),
    ).rejects.toThrow("phase seed failed");

    expect(listener).not.toHaveBeenCalled();
  });
});
