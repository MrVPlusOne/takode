import { getQuest } from "../server/quest-store.js";
import type { QuestmasterTask } from "../server/quest-types.js";
import { QUEST_LEADER_RECOVERY_WARNING_HEADER } from "../server/quest-recovery.js";
import { getQuestDisplayOwner, sameQuestOwner, type QuestOwnerRef } from "../shared/quest-owner.js";
import type { QuestServerClient } from "./quest-server-client.js";

export type QuestStatusMutationOverride = {
  force: boolean;
  reason?: string;
};

export type QuestStatusMutationDeps = {
  questServer: QuestServerClient;
  currentSessionId: string | undefined;
  codexOwner?: QuestOwnerRef;
  die: (message: string) => never;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
  warn?: (message: string) => void;
};

export function parseQuestStatusMutationOverride(deps: QuestStatusMutationDeps): QuestStatusMutationOverride {
  const force = deps.flag("force");
  const reason = deps.option("reason")?.trim();
  if (reason && !force) deps.die("--reason can only be used with --force for quest status changes.");
  if (force && !reason) deps.die("Forced quest status changes require --reason <text>.");
  return { force, ...(reason ? { reason } : {}) };
}

/**
 * Ownership guard for the server's in-process Codex Quest command worker, the
 * only caller that still writes the quest store from the CLI process.
 */
export async function guardDirectCodexQuestStatusMutation(
  deps: QuestStatusMutationDeps & { codexOwner: QuestOwnerRef },
  questId: string,
  override: QuestStatusMutationOverride,
  options: { targetSessionId?: string; requireOwner?: boolean } = {},
): Promise<void> {
  const current = await getQuest(questId);
  if (!current) return;
  if (override.force) deps.die("Direct Codex quest status changes do not support --force.");
  if (options.targetSessionId && options.targetSessionId !== deps.codexOwner.sessionId) {
    deps.die("Direct Codex quest status changes cannot target another session.");
  }
  const owner = getQuestDisplayOwner(current);
  if (options.requireOwner && !owner) {
    deps.die(`Only the current Codex owner can change ${questId} status.`);
  }
  if (owner && !sameQuestOwner(owner, deps.codexOwner)) {
    deps.die(`Refusing to change ${questId} status: the quest is owned by ${owner.kind} owner ${owner.sessionId}.`);
  }
}

export async function postQuestStatusMutation(
  deps: QuestStatusMutationDeps,
  questId: string,
  endpoint: "transition" | "complete" | "done" | "cancel",
  body: Record<string, unknown>,
): Promise<QuestmasterTask> {
  const { value, headers } = await deps.questServer.request<QuestmasterTask>(
    "POST",
    `/quests/${encodeURIComponent(questId)}/${endpoint}`,
    body,
  );
  const warning = headers.get(QUEST_LEADER_RECOVERY_WARNING_HEADER);
  if (warning) deps.warn?.(warning);
  return value;
}
