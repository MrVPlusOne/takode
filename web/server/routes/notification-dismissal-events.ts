import type { RouteContext } from "./context.js";
import type { BoardRow } from "../session-types.js";

type BridgeSession = NonNullable<ReturnType<RouteContext["wsBridge"]["getSession"]>>;

interface RowSnapshot {
  questId: string;
  worker?: string;
  status?: string;
  links: string[];
  open: string[];
}

interface DismissalSnapshot {
  open: Map<string, { summary?: string; questId?: string }>;
  rows: RowSnapshot[];
}

/**
 * Agents learn about a prompt the user dismissed in the UI only on their next delivery, and the
 * dismissal may end a quest's User Checkpoint. So the leader hears of it at once: of its own quest
 * questions, and of its herded workers' questions. Take a snapshot before marking prompts done, then
 * report the ones the dismissal resolved.
 */
export function snapshotNeedsInputForDismissal(session: BridgeSession): DismissalSnapshot {
  const open = new Map<string, { summary?: string; questId?: string }>();
  for (const notification of session.notifications) {
    if (notification.category !== "needs-input" || notification.done) continue;
    open.set(notification.id, { summary: notification.summary, questId: notification.questId });
  }
  const rows = [...session.board.values()].map((row: BoardRow) => ({
    questId: row.questId,
    worker: row.worker,
    status: row.status,
    links: row.waitForInput ?? [],
    open: row.openQuestions ?? [],
  }));
  return { open, rows };
}

export function reportNeedsInputDismissals(
  ctx: Pick<RouteContext, "wsBridge" | "launcher">,
  session: BridgeSession,
  before: DismissalSnapshot,
): void {
  const launcherSession = ctx.launcher.getSession(session.id);
  for (const [notificationId, prompt] of before.open) {
    const notification = session.notifications.find((entry) => entry.id === notificationId);
    if (!notification?.done) continue;
    const summary = prompt.summary ? { summary: prompt.summary } : {};

    if (launcherSession?.herdedBy) {
      ctx.wsBridge.emitTakodeEvent(session.id, "notification_dismissed", {
        notificationId,
        ...summary,
        ...(prompt.questId ? { questId: prompt.questId } : {}),
        askedBy: "worker",
      });
      continue;
    }
    if (launcherSession?.isOrchestrator !== true) continue;
    // A leader hears only of its quest questions; other dismissals stay quiet, as before.
    const rowBefore = before.rows.find(
      (row) => row.links.includes(notificationId) || row.open.includes(notificationId),
    );
    if (!rowBefore) continue;
    const rowAfter = session.board.get(rowBefore.questId) as BoardRow | undefined;
    ctx.wsBridge.herdEventDispatcher?.emitTakodeEventForOrchestrator(
      session.id,
      rowBefore.worker ?? session.id,
      "notification_dismissed",
      {
        notificationId,
        ...summary,
        questId: rowBefore.questId,
        askedBy: "leader",
        ...(rowBefore.status === "USER_CHECKPOINTING" && rowAfter?.status === "WORKING"
          ? { checkpointEnded: true }
          : {}),
      },
    );
  }
}
