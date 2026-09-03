export interface LeaderResponseThreadRouteFields {
  threadKey?: string;
  questId?: string;
  threadRefs?: ReadonlyArray<{
    threadKey: string;
    questId?: string;
    source: "explicit" | "inferred" | "backfill";
    attachedAt?: number;
  }>;
}

function validThreadKey(value: string | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key === "main" || (key !== undefined && /^q-\d+$/.test(key)) ? key : null;
}

function routeThreadKey(threadKey: string | undefined, questId: string | undefined): string | null {
  const directThread = validThreadKey(threadKey);
  const directQuest = validThreadKey(questId);
  if (directThread && directQuest && directThread !== directQuest) return null;
  return directThread ?? directQuest;
}

/**
 * Resolve the single current thread that owns answer coverage for a direct
 * human message. The newest explicit/inferred attachment transfers ownership;
 * backfill references affect visibility only.
 */
export function leaderResponseOwnerThreadKey(fields: LeaderResponseThreadRouteFields): string | null {
  let attached: { threadKey: string; attachedAt: number; index: number } | null = null;
  for (let index = 0; index < (fields.threadRefs?.length ?? 0); index += 1) {
    const ref = fields.threadRefs![index]!;
    if (ref.source === "backfill") continue;
    const threadKey = routeThreadKey(ref.threadKey, ref.questId);
    if (!threadKey) continue;
    const attachedAt =
      typeof ref.attachedAt === "number" && Number.isFinite(ref.attachedAt) ? ref.attachedAt : Number.NEGATIVE_INFINITY;
    if (
      !attached ||
      attachedAt > attached.attachedAt ||
      (attachedAt === attached.attachedAt && index > attached.index)
    ) {
      attached = { threadKey, attachedAt, index };
    }
  }
  if (attached) return attached.threadKey;
  return routeThreadKey(fields.threadKey, fields.questId) ?? "main";
}
