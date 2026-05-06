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

import { ensureSkillSymlinks } from "./skill-symlink.js";

describe("ensureSkillSymlinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockReturnValue([]);
    fsMocks.lstatSync.mockImplementation((_targetDir: string): { isSymbolicLink: () => boolean } => {
      throw missingPathError();
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

  it("discovers agents-only project skills and installs them only for agents", async () => {
    // Validates startup discovery for skills like impeccable that intentionally
    // exist only under the repo's .agents/skills directory.
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.agents/skills" || targetDir === "/repo/.agents/skills/impeccable";
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/repo/.agents/skills") {
        return [
          {
            name: "impeccable",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
        ] as any[];
      }
      return [];
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.agents/skills/impeccable",
      "/home/tester/.agents/skills/impeccable",
    );
    expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.any(String), "/home/tester/.claude/skills/impeccable");
  });

  it("skips deprecated Quest Journey aliases and removes stale global installs", async () => {
    // Legacy phase aliases remain board/catalog compatibility metadata, but
    // their old skill slugs must not be rediscovered as active worker skills.
    const deprecatedSlugs = [
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
        "/repo/.agents/skills",
      ].includes(targetDir);
    });
    fsMocks.readdirSync.mockImplementation((targetDir?: string) => {
      if (targetDir === "/repo/.claude/skills") {
        return [
          { name: "quest-journey-implement", isDirectory: () => true, isSymbolicLink: () => false },
          ...deprecatedSlugs.map((name) => ({
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
      if (targetDir === "/home/tester/.agents/skills/quest-journey-porting") {
        return { isSymbolicLink: () => false };
      }
      throw missingPathError();
    });

    await ensureSkillSymlinks([]);

    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/quest-journey-implement",
      "/home/tester/.claude/skills/quest-journey-implement",
    );
    expect(fsMocks.symlinkSync).toHaveBeenCalledWith(
      "/repo/.claude/skills/quest-journey-implement",
      "/home/tester/.agents/skills/quest-journey-implement",
    );
    for (const slug of deprecatedSlugs) {
      expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.stringContaining(slug), expect.any(String));
      expect(fsMocks.symlinkSync).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining(slug));
    }
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith("/home/tester/.claude/skills/quest-journey-planning");
    expect(fsMocks.rmSync).toHaveBeenCalledWith("/home/tester/.agents/skills/quest-journey-porting", {
      recursive: true,
    });
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
    // Validates q-275: startup should not create global skill symlinks for
    // hardcoded slugs that do not exist in the repo checkout.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fsMocks.existsSync.mockImplementation((targetDir: string) => {
      return targetDir === "/repo/.claude/skills" || targetDir === "/repo/.agents/skills";
    });

    await ensureSkillSymlinks(["cron-scheduling"]);

    expect(fsMocks.symlinkSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-symlink] Skipping missing repo skill source: /repo/.claude/skills/cron-scheduling or /repo/.agents/skills/cron-scheduling",
    );

    warnSpy.mockRestore();
  });
});
