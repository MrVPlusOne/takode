import type { ContextMenuItem } from "../components/ContextMenu.js";
import { useStore } from "../store.js";
import { writeClipboardText } from "./copy-utils.js";
import { navigateToSession, navigateToSessionThread } from "./routing.js";
import { canOpenInSide, openQuestInSide } from "./side-column.js";

/**
 * A quest's right-click (or long-press) menu wherever a quest is listed or linked: open it, open it
 * in the side column, its thread in its leader, its worker, and copy its number. The labels are
 * those of the quest actions in search results. With text selected, Copy comes first.
 */
export function questMenuItems(input: {
  questId: string;
  /** Opens the quest the way the item's own click does. */
  open: () => void;
  leaderSessionId?: string | null;
  workerSessionId?: string | null;
  selectedText?: string;
  /** Called after leaving for another session, so a covering view can close. */
  onLeave?: () => void;
}): ContextMenuItem[] {
  const { questId, open, leaderSessionId, workerSessionId, selectedText, onLeave } = input;
  const sessions = useStore.getState().sdkSessions ?? [];
  const numOf = (sessionId: string) => sessions.find((session) => session.sessionId === sessionId)?.sessionNum;
  const items: ContextMenuItem[] = [];
  if (selectedText) items.push({ label: "Copy", onClick: () => void copy(selectedText) });
  items.push({ label: "Open", onClick: open });
  if (canOpenInSide()) items.push({ label: "Open in side column", onClick: () => void openQuestInSide(questId) });
  if (leaderSessionId) {
    const num = numOf(leaderSessionId);
    items.push({
      label: `Open thread in leader${num != null ? ` #${num}` : ""}`,
      onClick: () => {
        navigateToSessionThread(leaderSessionId, questId, false, num ?? leaderSessionId);
        onLeave?.();
      },
    });
  }
  if (workerSessionId) {
    const num = numOf(workerSessionId);
    items.push({
      label: `Go to worker session${num != null ? ` #${num}` : ""}`,
      onClick: () => {
        navigateToSession(workerSessionId);
        onLeave?.();
      },
    });
  }
  items.push({ label: "Copy quest number", onClick: () => void copy(questId) });
  return items;
}

function copy(text: string): Promise<void> {
  return writeClipboardText(text).catch((error: unknown) => console.error("[quest-menu] Copy failed:", error));
}
