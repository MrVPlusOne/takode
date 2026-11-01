import type { BoardRow } from "../session-types.js";

/**
 * Why a quest cannot open a new round yet, or null when it can. A round whose board row is still in
 * Memory or waits in Landing is unfinished: reopening then closed it under its Memory (losing its
 * debrief), or let its landing complete the quest and close the new round before its work began.
 */
export function unfinishedRoundMessage(questId: string, rows: readonly BoardRow[]): string | null {
  const statuses = rows.map((row) => (row.status ?? "").trim().toUpperCase());
  const wait = statuses.includes("MEMORY")
    ? "is still in Memory; wait for its Memory to finish"
    : statuses.includes("LANDING")
      ? "is still waiting in Landing; wait for it to land"
      : null;
  if (!wait) return null;
  return (
    `${questId}'s current round ${wait} before opening another round. ` +
    `New work in the same area is a new quest: quest create --follow-up-of ${questId}`
  );
}
