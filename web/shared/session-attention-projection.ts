import { isPositiveInteger } from "./synced-projection-codec.js";

export const SESSION_ATTENTION_PROJECTION = "session-attention" as const;
export const SESSION_ATTENTION_PROJECTION_MAX_VALUE_BYTES = 512;

export type SessionAttentionReason = "action" | "error" | "review" | null;
export type SessionAttentionUrgency = "needs-input" | "review" | "muted-needs-input";

export interface SessionAttentionProjectionValue {
  attentionReason: SessionAttentionReason;
  status: {
    urgency: SessionAttentionUrgency;
    count: number;
  } | null;
}

export function sessionAttentionProjectionEqual(
  left: SessionAttentionProjectionValue,
  right: SessionAttentionProjectionValue,
): boolean {
  return (
    left.attentionReason === right.attentionReason &&
    left.status?.urgency === right.status?.urgency &&
    left.status?.count === right.status?.count
  );
}

export function isSessionAttentionProjectionValue(value: unknown): value is SessionAttentionProjectionValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionAttentionProjectionValue>;
  if (![null, "action", "error", "review"].includes(candidate.attentionReason as SessionAttentionReason)) return false;
  if (candidate.status === null) return true;
  if (!candidate.status || typeof candidate.status !== "object") return false;
  if (!["needs-input", "review", "muted-needs-input"].includes(candidate.status.urgency)) return false;
  return isPositiveInteger(candidate.status.count);
}
