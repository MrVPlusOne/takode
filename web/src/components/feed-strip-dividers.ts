import type { Turn } from "../hooks/use-feed-model.js";

/**
 * A quest strip (in a topic conversation or Main) introduces the turn below it, so nothing may come
 * between them (Jiayi): a day or time divider due at the turn's first visible message moves above
 * the strip, and the strip then follows the divider directly. Later dividers inside the quest's run
 * stay where they are. Returns the labels left for the feed's entries and, per turn index, the
 * divider to draw above its strip.
 */
export function dividersAboveStrips(
  turns: ReadonlyArray<Pick<Turn, "userEntry" | "allEntries">>,
  hasStrip: (turnIndex: number) => boolean,
  firstTimedMessageIds: ReadonlyArray<string | undefined>,
  labels: ReadonlyMap<string, string>,
): {
  entryBoundaryLabels: Map<string, string>;
  dividerAboveStrip: Map<number, { timestamp: number; label: string }>;
} {
  const dividerAboveStrip = new Map<number, { timestamp: number; label: string }>();
  const entryBoundaryLabels = new Map(labels);
  turns.forEach((turn, index) => {
    const firstId = firstTimedMessageIds[index];
    const label = firstId ? labels.get(firstId) : undefined;
    if (!firstId || !label || !hasStrip(index)) return;
    const entry = [turn.userEntry, ...turn.allEntries].find(
      (candidate) => candidate?.kind === "message" && candidate.msg.id === firstId,
    );
    if (entry?.kind !== "message") return;
    dividerAboveStrip.set(index, { timestamp: entry.msg.timestamp, label });
    entryBoundaryLabels.delete(firstId);
  });
  return { entryBoundaryLabels, dividerAboveStrip };
}
