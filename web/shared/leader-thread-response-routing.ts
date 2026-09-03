export interface LeaderResponseThreadRouteFields {
  threadKey?: string;
  questId?: string;
  threadRefs?: ReadonlyArray<{
    threadKey: string;
    questId?: string;
    source: "explicit" | "inferred" | "backfill";
  }>;
}

function validThreadKey(value: string | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key === "main" || (key !== undefined && /^q-\d+$/.test(key)) ? key : null;
}

/**
 * Resolve the single authoritative thread that owns response coverage for a
 * direct human message. Backfill references affect visibility only and never
 * transfer or duplicate response authority.
 */
export function leaderResponseOwnerThreadKey(fields: LeaderResponseThreadRouteFields): string | null {
  const directThread = validThreadKey(fields.threadKey);
  const directQuest = validThreadKey(fields.questId);
  if (directThread && directQuest && directThread !== directQuest) return null;
  if (directThread || directQuest) return directThread ?? directQuest;

  const referenced = new Set(
    (fields.threadRefs ?? [])
      .filter((ref) => ref.source !== "backfill")
      .flatMap((ref) => [validThreadKey(ref.threadKey), validThreadKey(ref.questId)])
      .filter((key): key is string => key !== null),
  );
  if (referenced.size > 1) return null;
  return referenced.values().next().value ?? "main";
}
