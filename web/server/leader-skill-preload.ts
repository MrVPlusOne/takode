import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgrammaticHistoryFollowUp } from "./session-types.js";
import { leaderSkillPreloadSourceId, leaderSkillPreloadSourceLabel } from "../shared/injected-event-message.js";

export interface LeaderSkillPreloadFile {
  repoPath: string;
  sourcePath: string;
  content: string;
}

export interface LeaderSkillPreloadBundle {
  skillName: string;
  source: string;
  files: LeaderSkillPreloadFile[];
  content: string;
  agentSource: { sessionId: string; sessionLabel: string };
}

interface LeaderSkillPreloadManifestEntry {
  skillName: string;
  source: string;
  files: string[];
}

export interface LeaderSkillPreloadBuildOptions {
  packageRoot?: string;
  readFile?: (path: string, encoding: "utf-8") => Promise<string>;
}

const DEFAULT_PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const LEADER_SKILL_PRELOAD_MANIFEST: readonly LeaderSkillPreloadManifestEntry[] = [
  {
    skillName: "takode-orchestration",
    source: "repo:.claude/skills/takode-orchestration",
    files: [".claude/skills/takode-orchestration/SKILL.md"],
  },
  {
    skillName: "leader-dispatch",
    source: "repo:.claude/skills/leader-dispatch",
    files: [".claude/skills/leader-dispatch/SKILL.md"],
  },
  {
    skillName: "confirm",
    source: "repo:.claude/skills/confirm",
    files: [".claude/skills/confirm/SKILL.md"],
  },
  {
    skillName: "quest",
    source: "generated:quest-skill-docs",
    files: ["web/server/templates/quest-skill-docs.md"],
  },
];

export async function buildLeaderSkillPreloadBundles(
  options: LeaderSkillPreloadBuildOptions = {},
): Promise<LeaderSkillPreloadBundle[]> {
  const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const read = options.readFile ?? readFile;
  return Promise.all(
    LEADER_SKILL_PRELOAD_MANIFEST.map(async (entry) => {
      const files = await Promise.all(
        entry.files.map(async (repoPath) => {
          const sourcePath = join(packageRoot, repoPath);
          const content = await read(sourcePath, "utf-8");
          return {
            repoPath,
            sourcePath,
            content,
          };
        }),
      );
      return {
        skillName: entry.skillName,
        source: entry.source,
        files,
        content: renderLeaderSkillPreloadBundle(entry.skillName, files),
        agentSource: {
          sessionId: leaderSkillPreloadSourceId(entry.skillName),
          sessionLabel: leaderSkillPreloadSourceLabel(entry.skillName),
        },
      };
    }),
  );
}

export function buildLeaderPreloadDeliveryContent(
  primaryMessage: string,
  bundles: readonly LeaderSkillPreloadBundle[],
): string {
  if (bundles.length === 0) return primaryMessage;
  return [
    primaryMessage,
    "The following required leader skill contents are included as startup/recovery context. Use them as already-loaded context. Do not reread these mandatory leader skills via tool calls unless checking freshness or debugging.",
    ...bundles.map((bundle) => bundle.content),
  ].join("\n\n");
}

export function buildLeaderSkillPreloadHistoryFollowUps(
  bundles: readonly LeaderSkillPreloadBundle[],
): ProgrammaticHistoryFollowUp[] {
  return bundles.map((bundle) => ({
    content: bundle.content,
    agentSource: bundle.agentSource,
  }));
}

function renderLeaderSkillPreloadBundle(skillName: string, files: readonly LeaderSkillPreloadFile[]): string {
  return [
    `Required leader skill preloaded: ${skillName}`,
    "",
    "Use this content as already-loaded leader context. Do not reread this mandatory skill via tool calls unless checking freshness or debugging.",
    "",
    ...files.map((file) => file.content.trimEnd()),
  ]
    .join("\n")
    .trimEnd();
}
