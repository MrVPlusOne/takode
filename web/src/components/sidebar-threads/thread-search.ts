import { useMemo } from "react";
import { multiWordMatch } from "../../../shared/search-utils.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import type { SdkSessionInfo } from "../../types.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { resolveSdkSessionNavigation } from "../../utils/session-navigation-resolver.js";
import { threadRows, useThreadsModeData, type ThreadRow } from "./SidebarThreadsMode.js";

/**
 * Threads in Universal Search (Jiayi, Nov 10: a thread just read couldn't be found again; search
 * matched only the user's own messages, and the thread's name was the leader's). Every leader's
 * threads, the same ones the sessions panel's Threads view lists, are matched by name and shown
 * above whatever the open tab finds; with nothing typed, the ones the user last dealt with or
 * viewed are shown instead.
 */

/** Threads shown above the tab's own results. */
export const THREAD_RESULTS_SHOWN = 5;

/**
 * Every live leader's threads as the Threads view has them (counts, group, when the user last
 * dealt with or viewed each one). Nothing loads while `active` is false.
 */
export function useAllThreadRows(sessions: readonly SdkSessionInfo[], active: boolean): ThreadRow[] {
  const nodes = useMemo(
    () =>
      sessions
        .filter((session) => session.isOrchestrator === true && !session.archived && session.hidden !== true)
        .map(
          (session): RecentSessionNode => ({
            leader: resolveSdkSessionNavigation(session).sidebarItem,
            workers: [],
            reviewers: [],
            spaceId: "",
            spaceName: "",
            recentAt: 0,
          }),
        ),
    [sessions],
  );
  const { leaders } = useThreadsModeData(nodes, active);
  const { queue } = useNextAttention();
  return useMemo(() => (active ? threadRows(leaders, queue) : []), [active, leaders, queue]);
}

/**
 * The threads to show for a query: those whose name has every word of it (as words or their starts),
 * else, with nothing typed, the ones the user dealt with or viewed at all. Newest first by that
 * time, then by the thread's own activity.
 */
export function searchThreadRows(rows: readonly ThreadRow[], query: string, limit = THREAD_RESULTS_SHOWN): ThreadRow[] {
  const typed = query.trim();
  const matches = typed ? rows.filter((row) => multiWordMatch(row.title, typed)) : rows.filter((row) => row.at > 0);
  return [...matches].sort((a, b) => b.at - a.at || b.activityAt - a.activityAt).slice(0, limit);
}
