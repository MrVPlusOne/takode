import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_DEFAULTS,
  normalizeSessionDefaults,
  resolveSessionDefaultsForRole,
} from "./session-defaults.js";

describe("session defaults schema", () => {
  it("migrates the legacy single-profile shape to worker defaults with dynamic leader sharing", () => {
    // Existing settings files have only codex/claude. Leaders must retain the old behavior until sharing is disabled.
    const normalized = normalizeSessionDefaults({
      codex: {
        model: "worker-codex",
        serviceTier: "priority",
        reasoningEffort: "high",
        internetAccess: true,
        maxContextLength: 240_000,
        effectiveContextWindowPercent: 90,
      },
      claude: {
        model: "worker-claude",
        permissionMode: "acceptEdits",
        reasoningEffort: "max",
        maxContextLength: 1_000_000,
      },
    });

    expect(normalized.leaderUsesWorkerDefaults).toBe(true);
    expect(normalized.leader.codex.model).toBe("worker-codex");
    expect(normalized.codex.effectiveContextWindowPercent).toBe(90);
    expect(resolveSessionDefaultsForRole(normalized, "leader").codex.model).toBe("worker-codex");
    expect(normalized.leader.codex).not.toHaveProperty("effectiveContextWindowPercent");
  });

  it("uses independent leader values without duplicating the global context estimate", () => {
    const normalized = normalizeSessionDefaults({
      ...DEFAULT_SESSION_DEFAULTS,
      codex: { ...DEFAULT_SESSION_DEFAULTS.codex, model: "worker-codex", effectiveContextWindowPercent: 88 },
      leaderUsesWorkerDefaults: false,
      leader: {
        codex: { ...DEFAULT_SESSION_DEFAULTS.leader.codex, model: "leader-codex", maxContextLength: 600_000 },
        claude: { ...DEFAULT_SESSION_DEFAULTS.leader.claude, model: "leader-claude" },
      },
    });

    expect(resolveSessionDefaultsForRole(normalized, "worker").codex.model).toBe("worker-codex");
    expect(resolveSessionDefaultsForRole(normalized, "leader")).toMatchObject({
      codex: { model: "leader-codex", maxContextLength: 600_000 },
      claude: { model: "leader-claude" },
    });
    expect(normalized.codex.effectiveContextWindowPercent).toBe(88);
    expect(normalized.leader.codex).not.toHaveProperty("effectiveContextWindowPercent");
  });

  it("fills partial leader data conservatively from the migrated worker profile", () => {
    // Partial/corrupt newer files should keep unspecified leader controls aligned with the known worker values.
    const normalized = normalizeSessionDefaults({
      codex: { model: "worker-codex", internetAccess: true },
      claude: { permissionMode: "plan" },
      leaderUsesWorkerDefaults: false,
      leader: { codex: { model: "leader-codex" } },
    });

    expect(normalized.leader.codex).toMatchObject({ model: "leader-codex", internetAccess: true });
    expect(normalized.leader.claude.permissionMode).toBe("plan");
  });
});
