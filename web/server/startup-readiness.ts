import type { ensureBuiltInQuestJourneyPhaseData } from "./quest-journey-phases.js";
import type { ensureQuestmasterIntegration } from "./quest-integration.js";
import type { ensureSkillSymlinks } from "./skill-symlink.js";
import type { ensureTakodeIntegration } from "./takode-integration.js";

/**
 * Project skills linked into the global skill homes at startup, on the
 * coordinator and on every host that runs its sessions.
 */
export const STARTUP_SKILL_SYMLINKS = [
  "takode-orchestration",
  "leader-dispatch",
  "leader-decision-communication",
  "confirm",
  "self-groom",
  "reviewer-groom",
  "skeptic-review",
  "worktree-rules",
  "random-memory-ideas",
];

export interface PreListenStartupReadinessDeps {
  ensureQuestmasterIntegration: typeof ensureQuestmasterIntegration;
  ensureTakodeIntegration: typeof ensureTakodeIntegration;
  ensureBuiltInQuestJourneyPhaseData: typeof ensureBuiltInQuestJourneyPhaseData;
  ensureSkillSymlinks: typeof ensureSkillSymlinks;
}

export interface PreListenStartupReadinessOptions {
  port: number;
  packageRoot: string;
  startupSkillSlugs: string[];
}

export async function runPreListenStartupReadiness(
  deps: PreListenStartupReadinessDeps,
  options: PreListenStartupReadinessOptions,
): Promise<void> {
  await deps.ensureQuestmasterIntegration(options.port, options.packageRoot);
  await deps.ensureTakodeIntegration(options.packageRoot);
  await deps.ensureBuiltInQuestJourneyPhaseData({ packageRoot: options.packageRoot });
  await deps.ensureSkillSymlinks(options.startupSkillSlugs);
}
