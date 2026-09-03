export const LEADER_USER_MESSAGE_ID_RE = /^u[1-9]\d*$/;

export function isCanonicalLeaderUserMessageId(value: unknown): value is string {
  return typeof value === "string" && LEADER_USER_MESSAGE_ID_RE.test(value);
}

/**
 * Assign deterministic session-scoped IDs while reserving every persisted ID,
 * including duplicated/corrupted values that must never be silently reissued.
 */
export function assignSessionScopedLeaderUserMessageIds(persistedIds: readonly unknown[]): string[] {
  const persistedCounts = new Map<string, number>();
  for (const value of persistedIds) {
    if (!isCanonicalLeaderUserMessageId(value)) continue;
    persistedCounts.set(value, (persistedCounts.get(value) ?? 0) + 1);
  }

  const reserved = new Set(persistedCounts.keys());
  const assigned = new Set<string>();
  let nextOrdinal = 1;
  const allocate = (): string => {
    while (reserved.has(`u${nextOrdinal}`) || assigned.has(`u${nextOrdinal}`)) nextOrdinal += 1;
    return `u${nextOrdinal++}`;
  };

  return persistedIds.map((value) => {
    const id =
      isCanonicalLeaderUserMessageId(value) && persistedCounts.get(value) === 1 && !assigned.has(value)
        ? value
        : allocate();
    assigned.add(id);
    return id;
  });
}
