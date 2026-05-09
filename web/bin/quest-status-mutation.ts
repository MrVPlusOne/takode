import { getQuest } from "../server/quest-store.js";
import type { QuestmasterTask } from "../server/quest-types.js";
import { evaluateQuestStatusMutationGuard } from "../server/quest-status-guard.js";

export type QuestStatusMutationOverride = {
  force: boolean;
  reason?: string;
};

export type QuestStatusMutationDeps = {
  companionAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  companionPort: string | undefined;
  currentSessionId: string | undefined;
  die: (message: string) => never;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
};

export function parseQuestStatusMutationOverride(deps: QuestStatusMutationDeps): QuestStatusMutationOverride {
  const force = deps.flag("force");
  const reason = deps.option("reason")?.trim();
  if (reason && !force) deps.die("--reason can only be used with --force for quest status changes.");
  if (force && !reason) deps.die("Forced quest status changes require --reason <text>.");
  return { force, ...(reason ? { reason } : {}) };
}

export async function guardLocalQuestStatusMutation(
  deps: QuestStatusMutationDeps,
  questId: string,
  override: QuestStatusMutationOverride,
  options: { targetSessionId?: string } = {},
): Promise<void> {
  const current = await getQuest(questId);
  if (!current) return;
  const result = evaluateQuestStatusMutationGuard(current, {
    callerSessionId: deps.currentSessionId,
    callerIsLeader: process.env.TAKODE_ROLE === "orchestrator",
    force: override.force,
    reason: override.reason,
    targetSessionId: options.targetSessionId,
  });
  if (!result.ok) deps.die(result.message);
}

export async function postQuestStatusMutation(
  deps: QuestStatusMutationDeps,
  questId: string,
  endpoint: "transition" | "complete" | "done" | "cancel",
  body: Record<string, unknown>,
): Promise<QuestmasterTask | null> {
  if (!deps.companionPort) return null;
  try {
    const res = await fetch(
      `http://localhost:${deps.companionPort}/api/quests/${encodeURIComponent(questId)}/${endpoint}`,
      {
        method: "POST",
        headers: deps.companionAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      deps.die((err as { error: string }).error || res.statusText);
    }
    return (await res.json()) as QuestmasterTask;
  } catch (e) {
    const error = e as Error;
    if (error.name === "AbortError" || error.message?.includes("timeout")) return null;
    deps.die(error.message);
  }
}
