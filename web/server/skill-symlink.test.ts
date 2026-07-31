import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn((_targetDir: string) => false),
  mkdirSync: vi.fn(),
  symlinkSync: vi.fn(),
  lstatSync: vi.fn((_targetDir: string): { isSymbolicLink: () => boolean } => {
    throw missingPathError();
  }),
  readlinkSync: vi.fn(),
  readdirSync: vi.fn((_targetDir?: string): any[] => []),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
}));
const fsPromisesMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

function missingPathError(): Error & { code: string } {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

const execMock = vi.hoisted(() =>
  vi.fn((_command: string, _options: object, callback: (error: Error | null, stdout: string) => void) => {
    callback(null, "../.git\n");
  }),
);

vi.mock("node:os", () => ({
  homedir: () => "/home/tester",
}));

vi.mock("node:child_process", () => ({
  exec: execMock,
}));

vi.mock("node:url", () => ({
  fileURLToPath: () => "/repo/web/server/skill-symlink.ts",
}));

vi.mock("node:fs", () => fsMocks);
vi.mock("node:fs/promises", () => fsPromisesMocks);

import { ensureSkillSymlinks } from "./skill-symlink.js";

const TEST_ROOTS = {
  mainRepoRoot: "/repo",
  claudeSkillsHome: "/home/tester/.claude/skills",
  agentsSkillsHome: "/home/tester/.agents/skills",
  legacyCodexSkillsHome: "/home/tester/.codex/skills",
};
const VALID_SKILL = "---\nname: test\ndescription: Test skill\n---\n\n# Test skill\n";

describe("ensureSkillSymlinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockReturnValue([]);
    fsMocks.lstatSync.mockImplementation((_targetDir: string): { isSymbolicLink: () => boolean } => {
      throw missingPathError();
    });
    fsPromisesMocks.stat.mockImplementation(async (skillPath: string) => {
      const skillDir = skillPath.replace(/\/SKILL\.md$/, "");
      if (skillDir.startsWith("/home/tester/")) return { isFile: () => true };
      if (!fsMocks.existsSync(skillDir)) throw missingPathError();
      return { isFile: () => true };
    });
    fsPromisesMocks.readFile.mockImplementation(async (skillPath: string) => {
      const skillDir = skillPath.replace(/\/SKILL\.md$/, "");
      if (skillDir.startsWith("/home/tester/")) return VALID_SKILL;
      if (!fsMocks.existsSync(skillDir)) throw missingPathError();
      return VALID_SKILL;
    });
  });

  it("symlinks project skills into Claude and agents homes", async () => {
    // Validates the shared project-skill fallback used by takode-orchestration,
    // which currently only exists under the repo's .claude/skills directory.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills/takode-orchestration";
    });

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.claude/skills/takode-orchestration",
    );
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      expect.any(String),
      "/home/tester/.codex/skills/takode-orchestration",
    );
  });

  it("replaces stale copied agent skill directories with repo symlinks", async () => {
    // Validates the observed bug: old copied ~/.agents skills are replaced with
    // repo-backed symlinks, so subdocs like quest-journey.md stay available.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills/takode-orchestration";
    });
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/takode-orchestration") {
        return { isSymbolicLink: () => false };
      }
      throw missingPathError();
    });

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.agents/skills/takode-orchestration", {
      recursive: true,
    });
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
  });

  it("uses repo-local agent skill directories when present", async () => {
    // Validates agent-specific variants are preserved instead of being replaced
    // by the Claude source when the repo has an .agents/skills copy.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return (
        targetDir === "/repo/.agents/skills/browser-validator" || targetDir === "/repo/.claude/skills/browser-validator"
      );
    });

    await ensureSkillSymlinks(["browser-validator"]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.agents/skills/browser-validator",
      "/home/tester/.agents/skills/browser-validator",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      expect.any(String),
      "/home/tester/.codex/skills/browser-validator",
    );
  });

  it("falls back to the populated Claude source when an existing agent directory has no skill payload", async () => {
    // Directory presence alone must not suppress fallback to a usable canonical source.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return (
        targetDir === "/repo/.claude/skills/takode-orchestration" ||
        targetDir === "/repo/.agents/skills/takode-orchestration"
      );
    });
    fsPromisesMocks.stat.mockImplementation(async (skillPath: string) => {
      if (skillPath === "/repo/.claude/skills/takode-orchestration/SKILL.md") {
        return { isFile: () => true };
      }
      throw missingPathError();
    });
    fsPromisesMocks.readFile.mockResolvedValue(
      "---\nname: orchestration\ndescription: Canonical orchestration skill\n---\n\n# Canonical orchestration skill\n",
    );

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      "/repo/.agents/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
  });

  it("rejects partial disposable roots before any installation mutation", async () => {
    await expect(
      ensureSkillSymlinks(["takode-orchestration"], {
        mainRepoRoot: "/disposable/repo",
      } as unknown as typeof TEST_ROOTS),
    ).rejects.toThrow("Disposable roots must provide");

    expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
    expect(fsMocks.symlinkSync).not.toHaveBeenCalled();
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
    expect(fsMocks.rmSync).not.toHaveBeenCalled();
    expect(fsPromisesMocks.stat).not.toHaveBeenCalled();
    expect(fsPromisesMocks.readFile).not.toHaveBeenCalled();
  });

  it.each([
    "stat",
    "read",
  ] as const)("rolls back a link after post-link %s invalidation and falls back to the canonical source", async (failureMode) => {
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return (
        targetDir === "/repo/.claude/skills/takode-orchestration" ||
        targetDir === "/repo/.agents/skills/takode-orchestration"
      );
    });
    let agentsTargetLstatCalls = 0;
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/takode-orchestration") {
        agentsTargetLstatCalls += 1;
        if (agentsTargetLstatCalls === 2) return { isSymbolicLink: () => true };
      }
      throw missingPathError();
    });
    let agentsTargetStatCalls = 0;
    fsPromisesMocks.stat.mockImplementation(async (skillPath: string) => {
      if (skillPath === "/home/tester/.agents/skills/takode-orchestration/SKILL.md") {
        agentsTargetStatCalls += 1;
        if (failureMode === "stat" && agentsTargetStatCalls === 1) throw missingPathError();
        return { isFile: () => true };
      }
      return { isFile: () => true };
    });
    fsPromisesMocks.readFile.mockImplementation(async (skillPath: string) => {
      if (
        failureMode === "read" &&
        skillPath === "/home/tester/.agents/skills/takode-orchestration/SKILL.md" &&
        agentsTargetStatCalls === 1
      ) {
        throw missingPathError();
      }
      return VALID_SKILL;
    });

    await ensureSkillSymlinks(["takode-orchestration"], TEST_ROOTS);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.agents/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.agents/skills/takode-orchestration");
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
  });

  it("removes a post-link invalidated install when no fallback remains", async () => {
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.agents/skills/agent-only";
    });
    let targetLstatCalls = 0;
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/agent-only") {
        targetLstatCalls += 1;
        if (targetLstatCalls === 2) return { isSymbolicLink: () => true };
      }
      throw missingPathError();
    });
    fsPromisesMocks.stat.mockImplementation(async (skillPath: string) => {
      if (skillPath === "/repo/.agents/skills/agent-only/SKILL.md") return { isFile: () => true };
      throw missingPathError();
    });
    fsPromisesMocks.readFile.mockResolvedValue(VALID_SKILL);

    await ensureSkillSymlinks(["agent-only"], TEST_ROOTS);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.agents/skills/agent-only",
      "/home/tester/.agents/skills/agent-only",
    );
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.agents/skills/agent-only");
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      "/repo/.claude/skills/agent-only",
      "/home/tester/.agents/skills/agent-only",
    );
  });

  it("reports neither-usable sources as skipped rather than installed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills/unusable" || targetDir === "/repo/.agents/skills/unusable";
    });
    fsPromisesMocks.stat.mockRejectedValue(missingPathError());

    await ensureSkillSymlinks(["unusable"], TEST_ROOTS);

    expect(fsMocks.symlinkSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("[skill-symlink] Installed none; skipped unusable:claude, unusable:agents");
    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-symlink] Skipping repo skill without usable SKILL.md: /repo/.claude/skills/unusable or /repo/.agents/skills/unusable",
    );
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("discovers agents-only project skills and installs them only for agents", async () => {
    // Validates startup discovery for agent-specific skills that intentionally
    // exist only under the repo's .agents/skills directory.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.agents/skills" || targetDir === "/repo/.agents/skills/browser-analyst";
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/repo/.agents/skills") {
        return [
          {
            name: "browser-analyst",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
        ] as any[];
      }
      return [];
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.agents/skills/browser-analyst",
      "/home/tester/.agents/skills/browser-analyst",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      expect.any(String),
      "/home/tester/.claude/skills/browser-analyst",
    );
  });

  it("discovers Claude-only project skills and installs them for Claude and agents", async () => {
    // Validates concise project skills can live only in the canonical Claude
    // source while still becoming available to non-Claude agents.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills" || targetDir === "/repo/.claude/skills/takode-orchestration-design";
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/repo/.claude/skills") {
        return [
          {
            name: "takode-orchestration-design",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
        ] as any[];
      }
      return [];
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration-design",
      "/home/tester/.claude/skills/takode-orchestration-design",
    );
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration-design",
      "/home/tester/.agents/skills/takode-orchestration-design",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      expect.any(String),
      "/home/tester/.codex/skills/takode-orchestration-design",
    );
  });

  it("skips Quest Journey phase skills and removes stale global installs", async () => {
    // Phase instructions are distributed as explicit phase briefs, not
    // auto-discovered skills. Cleanup runs across all three skill homes so
    // stale symlinks or old copied directories stop being worker-visible.
    const questJourneySkillSlugs = [
      "quest-journey-alignment",
      "quest-journey-explore",
      "quest-journey-implement",
      "quest-journey-code-review",
      "quest-journey-mental-simulation",
      "quest-journey-execute",
      "quest-journey-outcome-review",
      "quest-journey-user-checkpoint",
      "quest-journey-bookkeeping",
      "quest-journey-port",
      "quest-journey-planning",
      "quest-journey-implementation",
      "quest-journey-skeptic-review",
      "quest-journey-reviewer-groom",
      "quest-journey-porting",
    ];
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return [
        "/home/tester/.codex/skills",
        "/repo/.claude/skills",
        "/repo/.claude/skills/quest-journey-implement",
        "/repo/.claude/skills/takode-orchestration",
        "/repo/.agents/skills",
      ].includes(targetDir);
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/repo/.claude/skills") {
        return [
          { name: "takode-orchestration", isDirectory: () => true, isSymbolicLink: () => false },
          { name: "quest-journey-implement", isDirectory: () => true, isSymbolicLink: () => false },
          ...questJourneySkillSlugs.map((name) => ({
            name,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          })),
        ] as any[];
      }
      if (targetDir === "/home/tester/.codex/skills") {
        return [{ name: "quest-journey-porting" } as any];
      }
      return [];
    });
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.claude/skills/quest-journey-planning") {
        return { isSymbolicLink: () => true };
      }
      if (targetDir === "/home/tester/.claude/skills/quest-journey-code-review") {
        return { isSymbolicLink: () => true };
      }
      if (targetDir === "/home/tester/.agents/skills/quest-journey-implement") {
        return { isSymbolicLink: () => false };
      }
      if (targetDir === "/home/tester/.agents/skills/quest-journey-porting") {
        return { isSymbolicLink: () => false };
      }
      if (targetDir === "/home/tester/.codex/skills/quest-journey-porting") {
        return { isSymbolicLink: () => true };
      }
      throw missingPathError();
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.claude/skills/takode-orchestration",
    );
    for (const slug of questJourneySkillSlugs) {
      expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.stringContaining(slug), expect.any(String));
      expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining(slug));
    }
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.claude/skills/quest-journey-planning");
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.claude/skills/quest-journey-code-review");
    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest-journey-implement", {
      recursive: true,
    });
    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest-journey-porting", {
      recursive: true,
    });
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.codex/skills/quest-journey-porting");
  });

  it("removes stale global installs for removed project skills", async () => {
    // Removed project skills should stop being discoverable even if an earlier
    // startup left repo-owned symlinks or copied directories in global homes.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.agents/skills";
    });
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.claude/skills/impeccable") {
        return { isSymbolicLink: () => true };
      }
      if (targetDir === "/home/tester/.agents/skills/impeccable") {
        return { isSymbolicLink: () => false };
      }
      if (targetDir === "/home/tester/.codex/skills/impeccable") {
        return { isSymbolicLink: () => true };
      }
      throw missingPathError();
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.claude/skills/impeccable");
    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.agents/skills/impeccable", { recursive: true });
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.codex/skills/impeccable");
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.stringContaining("impeccable"), expect.any(String));
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining("impeccable"));
  });

  it("removes stale project-owned legacy Codex skill copies instead of migrating them", async () => {
    // The generated quest skill is installed into .claude and .agents. A stale
    // legacy .codex copy can otherwise keep obsolete guidance discoverable.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return ["/home/tester/.codex/skills", "/repo/.claude/skills", "/repo/.agents/skills"].includes(targetDir);
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/home/tester/.codex/skills") {
        return [
          { name: "quest", isDirectory: () => true, isSymbolicLink: () => false },
          { name: "third-party", isDirectory: () => true, isSymbolicLink: () => false },
        ] as any[];
      }
      return [];
    });
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.codex/skills/quest") {
        return { isSymbolicLink: () => false };
      }
      throw missingPathError();
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.codex/skills/quest", { recursive: true });
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/home/tester/.codex/skills/third-party",
      "/home/tester/.agents/skills/third-party",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      "/home/tester/.codex/skills/quest",
      "/home/tester/.agents/skills/quest",
    );
  });

  it("ignores repo-local legacy Codex skill directories for active installs", async () => {
    // Validates .codex/skills is compatibility-only; project-specific non-Claude
    // variants now come from .agents, then fall back to .claude.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return (
        targetDir === "/repo/.codex/skills/takode-orchestration" ||
        targetDir === "/repo/.claude/skills/takode-orchestration"
      );
    });

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      "/repo/.codex/skills/takode-orchestration",
      expect.any(String),
    );
  });

  it("migrates legacy-only global Codex skills into agents with symlinks", async () => {
    // Validates unique old ~/.codex/skills content remains discoverable after
    // .agents becomes the active non-Claude skill root.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return (
        targetDir === "/home/tester/.codex/skills" ||
        targetDir === "/home/tester/.codex/skills/pdf" ||
        targetDir === "/repo/.claude/skills/takode-orchestration"
      );
    });
    fsMocks.readdirSync.mockReturnValue([{ name: "pdf" } as any]);

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/home/tester/.codex/skills/pdf",
      "/home/tester/.agents/skills/pdf",
    );
  });

  it("leaves an existing correct agent symlink alone", async () => {
    // Validates the startup path stays idempotent once ~/.agents already
    // points at the expected repo-backed skill directory.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills/takode-orchestration";
    });
    fsMocks.lstatSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/takode-orchestration") {
        return { isSymbolicLink: () => true };
      }
      throw missingPathError();
    });
    fsMocks.readlinkSync.mockImplementation((targetDir: string) => {
      if (targetDir === "/home/tester/.agents/skills/takode-orchestration") {
        return "/repo/.claude/skills/takode-orchestration";
      }
      return "";
    });

    await ensureSkillSymlinks(["takode-orchestration"]);

    expect(fsMocks.unlinkSync).not.toHaveBeenCalledWith("/home/tester/.agents/skills/takode-orchestration");
    expect(fsMocks.rmSync).not.toHaveBeenCalledWith("/home/tester/.agents/skills/takode-orchestration", {
      recursive: true,
    });
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(
      "/repo/.claude/skills/takode-orchestration",
      "/home/tester/.agents/skills/takode-orchestration",
    );
  });

  it("skips missing repo skill sources instead of creating broken symlinks", async () => {
    // Startup must not create global skill symlinks for hardcoded slugs that
    // do not exist in the repo checkout.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills" || targetDir === "/repo/.agents/skills";
    });

    await ensureSkillSymlinks(["cron-scheduling"]);

    expect(fsMocks.symlinkSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-symlink] Skipping repo skill without usable SKILL.md: /repo/.claude/skills/cron-scheduling or /repo/.agents/skills/cron-scheduling",
    );

    warnSpy.mockRestore();
  });
});
