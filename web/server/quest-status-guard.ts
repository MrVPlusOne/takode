import type { QuestmasterTask } from "./quest-types.js";
import { getQuestDisplayOwner } from "../shared/quest-owner.js";

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
  const owner = getQuestDisplayOwner(quest);
  return owner?.kind === "takode" ? [owner.sessionId] : [];
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

  const owner = getQuestDisplayOwner(quest);
  if (owner?.kind === "codex") {
    return {
      ok: false,
      message:
        `Refusing to change ${quest.questId} status: the quest owner is a direct Codex task, not Takode session ` +
        `${callerSessionId}. If this is intentional, retry with --force --reason <text>.`,
    };
  }

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
