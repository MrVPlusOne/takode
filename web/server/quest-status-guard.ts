import type { QuestmasterTask } from "./quest-types.js";

export type QuestStatusMutationGuardInput = {
  callerIsLeader?: boolean;
  callerLeadsCurrentOwner?: boolean;
  callerSessionId?: string;
  force?: boolean;
  reason?: string;
  targetSessionId?: string;
};

export type QuestStatusMutationGuardResult = { ok: true; overrideReason?: string } | { ok: false; message: string };

export function getQuestStatusOwnerSessionIds(quest: QuestmasterTask): string[] {
  if ("sessionId" in quest && typeof quest.sessionId === "string" && quest.sessionId.trim()) {
    return [quest.sessionId.trim()];
  }

  const previousOwner = quest.previousOwnerSessionIds?.at(-1)?.trim();
  return previousOwner ? [previousOwner] : [];
}

export function evaluateQuestStatusMutationGuard(
  quest: QuestmasterTask,
  input: QuestStatusMutationGuardInput,
): QuestStatusMutationGuardResult {
  const reason = input.reason?.trim() ?? "";
  if (input.force) {
    if (!reason) return { ok: false, message: "Forced quest status changes require --reason <text>." };
    return { ok: true, overrideReason: reason };
  }

  const callerSessionId = input.callerSessionId?.trim() ?? "";
  if (!callerSessionId) return { ok: true };

  const leaderSessionId = quest.leaderSessionId?.trim() ?? "";
  if (
    input.callerIsLeader &&
    (!leaderSessionId || leaderSessionId === callerSessionId || input.callerLeadsCurrentOwner)
  ) {
    return { ok: true };
  }

  const ownerSessionIds = getQuestStatusOwnerSessionIds(quest);
  if (ownerSessionIds.includes(callerSessionId)) return { ok: true };

  const targetSessionId = input.targetSessionId?.trim() ?? "";
  if (targetSessionId === callerSessionId && ownerSessionIds.length === 0 && !leaderSessionId) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      `Refusing to change ${quest.questId} status: caller ${callerSessionId} is neither the quest leader ` +
      "nor the current worker/owner. If this is intentional, retry with --force --reason <text>.",
  };
}
