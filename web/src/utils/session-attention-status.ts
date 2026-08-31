import type { SessionAttentionProjectionValue } from "../../shared/session-attention-projection.js";

export type EffectiveSessionAttentionStatus = NonNullable<SessionAttentionProjectionValue["status"]>;

/** Current-build attention visuals fail closed until an accepted projection value exists. */
export function projectedSessionAttentionStatus(
  projection: SessionAttentionProjectionValue | undefined,
): EffectiveSessionAttentionStatus | null {
  return projection?.status ?? null;
}
