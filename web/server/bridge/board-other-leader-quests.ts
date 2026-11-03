import type { QuestmasterTask } from "../quest-types.js";
import * as questStore from "../quest-store.js";
import type { BoardRow } from "../session-types.js";
import {
  applyLeaderThreadTabUpdate,
  normalizeLeaderOpenThreadTabsState,
} from "../../shared/leader-open-thread-tabs.js";
import { commitBoard, getBoard, type WorkBoardStateDeps } from "./board-watchdog-controller.js";

/**
 * Quests another leader runs. A leader that guessed a quest ID boarded another leader's quest
 * (Jiayi, Nov 3: three times in a day), and after `board rm` the quest stayed in its thread lists
 * and its Next walk: `rm` records a removed row as finished here, with an unread "quest complete"
 * and an open thread tab. So `board set` refuses another leader's quest unless told to take it
 * over, and `board rm` of one drops every trace of it from this leader.
 */

/** A running or paused leader (an orchestrator session that is not archived), by session ID. */
export type IsActiveLeader = (sessionId: string) => boolean;

/**
 * The other active leader that runs a quest, if any: its recorded leader, else (for a quest no
 * leader has boarded yet) the leader whose message started it. Null when the quest is this
 * leader's, or no other active leader has it.
 */
export function otherLeaderOfQuest(
  quest: Pick<QuestmasterTask, "leaderSessionId" | "relationships">,
  callerId: string,
  isActiveLeader: IsActiveLeader,
): string | null {
  const leader = quest.leaderSessionId || quest.relationships?.startedFrom?.sessionId;
  return leader && leader !== callerId && isActiveLeader(leader) ? leader : null;
}

/**
 * Takes another leader's quests off this leader as if they had never been boarded here: the active
 * or finished row goes (no board history, no "finished" record), this leader's notifications for
 * their threads are marked done, and their thread tabs close. The quests themselves, and the other
 * leader's board and threads, are untouched. Returns the quest IDs dropped.
 */
export function dropOtherLeadersQuests(session: any, questIds: readonly string[], deps: WorkBoardStateDeps): string[] {
  const dropped: string[] = [];
  for (const questId of questIds) {
    const key = questId.toLowerCase();
    const boardKey = [...session.board.keys()].find((candidate: string) => candidate.toLowerCase() === key);
    const completedKey = [...session.completedBoard.keys()].find(
      (candidate: string) => candidate.toLowerCase() === key,
    );
    if (!boardKey && !completedKey) continue;
    const row: BoardRow | undefined = boardKey ? session.board.get(boardKey) : undefined;
    for (const notificationId of row?.waitForInput ?? []) deps.markNotificationDone(session.id, notificationId, true);
    if (boardKey) session.board.delete(boardKey);
    if (completedKey) session.completedBoard.delete(completedKey);
    session.boardStallStates?.delete(boardKey ?? completedKey);
    for (const notification of session.notifications ?? []) {
      const thread = (notification.threadKey || notification.questId || "").toLowerCase();
      if (thread === key && !notification.done) deps.markNotificationDone(session.id, notification.id, true);
    }
    const tabs = normalizeLeaderOpenThreadTabsState(session.state?.leaderOpenThreadTabs);
    const closed = applyLeaderThreadTabUpdate(tabs, { type: "close", threadKey: key });
    if (closed && closed !== tabs) session.state.leaderOpenThreadTabs = closed;
    dropped.push(boardKey ?? completedKey!);
  }
  if (dropped.length) commitBoard(session, deps, dropped);
  return dropped;
}

interface LeaderLookup {
  getSession?: (
    sessionId: string,
  ) => { isOrchestrator?: boolean; archived?: boolean; sessionNum?: number; name?: string } | null | undefined;
}

/** The board routes' side of it: refusing to board another leader's quest, and removing one. */
export function otherLeaderQuestGuard(launcher: LeaderLookup) {
  const isActiveLeader: IsActiveLeader = (sessionId) => {
    const info = launcher.getSession?.(sessionId);
    return info?.isOrchestrator === true && info.archived !== true;
  };
  const label = (sessionId: string): string => {
    const info = launcher.getSession?.(sessionId);
    return info?.sessionNum !== undefined ? `#${info.sessionNum}${info.name ? ` ${info.name}` : ""}` : sessionId;
  };
  return {
    /** Why `callerId` may not board this quest without taking it over; null when it may. */
    refusal(questId: string, quest: QuestmasterTask, callerId: string): string | null {
      const other = otherLeaderOfQuest(quest, callerId, isActiveLeader);
      if (!other) return null;
      return `${questId} is ${label(other)}'s quest ("${quest.title}"), not yours. Check the quest ID: IDs are printed by quest create, and are not sequential guesses. To board it anyway, take it over with --take-over; ${label(other)} keeps its own row.`;
    },
    /**
     * `board rm`: another leader's quests leave no trace (`dropOtherLeadersQuests`), this leader's
     * own finish as usual through `removeOwn`.
     */
    async removeRows(
      session: any,
      questIds: readonly string[],
      deps: WorkBoardStateDeps,
      removeOwn: (questIds: string[]) => BoardRow[],
    ): Promise<{ board: BoardRow[]; dropped: string[] }> {
      const others: string[] = [];
      for (const questId of questIds) {
        const quest = await questStore.getQuest(questId).catch(() => null);
        if (quest && otherLeaderOfQuest(quest, session.id, isActiveLeader)) others.push(questId);
      }
      const dropped = dropOtherLeadersQuests(session, others, deps);
      const own = questIds.filter((questId) => !others.includes(questId));
      return { board: own.length ? removeOwn(own) : getBoard(session), dropped };
    },
  };
}
