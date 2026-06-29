export interface PendingTargetWindowRequest {
  key: string;
  revision: number;
}

export type MissingScrollTargetWindowAction =
  | { kind: "request"; pending: PendingTargetWindowRequest }
  | { kind: "wait" }
  | { kind: "fallback" };

export function getMissingScrollTargetWindowAction({
  pending,
  requestKey,
  revision,
}: {
  pending: PendingTargetWindowRequest | null;
  requestKey: string;
  revision: number;
}): MissingScrollTargetWindowAction {
  if (!pending || pending.key !== requestKey) {
    return { kind: "request", pending: { key: requestKey, revision } };
  }
  if (pending.revision === revision) return { kind: "wait" };
  return { kind: "fallback" };
}
