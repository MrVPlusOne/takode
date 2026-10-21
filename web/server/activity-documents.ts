import type { ActivitySessionDocument } from "./activity-stream.js";
import * as sessionNames from "./session-names.js";
import * as treeGroupStore from "./tree-group-store.js";
import type { RouteContext } from "./routes/context.js";

type SessionSources = Pick<RouteContext, "launcher" | "wsBridge" | "sessionStore">;

/** Session spaces (tree groups) by display name, and the space a session belongs to. */
export async function loadSessionSpaces(ctx: SessionSources) {
  const treeState = await treeGroupStore.getState();
  const spaceName = new Map(treeState.groups.map((group) => [group.id, group.name] as const));
  const spaceOf = (sessionId: string): string => {
    const groupId =
      ctx.wsBridge.getSession(sessionId)?.state.treeGroupId ||
      ctx.launcher.getSession(sessionId)?.treeGroupId ||
      treeState.assignments[sessionId] ||
      "default";
    return spaceName.get(groupId) ?? groupId;
  };
  return { names: [...spaceName.values()], nameOf: (groupId: string) => spaceName.get(groupId), spaceOf };
}

/**
 * The histories the activity stream reads: every visible session in `spaces` (all spaces when
 * null) that may have been active since `since`. Sessions archived before this server started
 * keep their history only on disk; `loadArchived: false` skips them instead of reading it.
 */
export async function collectActivityDocuments(
  ctx: SessionSources,
  options: {
    spaceOf: (sessionId: string) => string;
    spaces: string[] | null;
    since: number;
    loadArchived: boolean;
  },
): Promise<{ documents: ActivitySessionDocument[]; unreadable: Array<{ session: number | null; error: string }> }> {
  const documents: ActivitySessionDocument[] = [];
  const unreadable: Array<{ session: number | null; error: string }> = [];
  for (const session of ctx.launcher.listSessions()) {
    const bridgeSession = ctx.wsBridge.getSession(session.sessionId);
    if (!bridgeSession) continue;
    // Hidden sessions are delegate children driven by an agent, except Side Chats, which the user types into.
    const sideChat = bridgeSession.state.slackThreadChild;
    if ((session.hidden || bridgeSession.state.hidden) && !sideChat) continue;
    const space = options.spaceOf(sideChat?.rootSessionId ?? session.sessionId);
    if (options.spaces && !options.spaces.includes(space)) continue;
    // A session last active before the window cannot contribute; skip it before loading archived history.
    const lastActive = session.archived ? (session.archivedAt ?? session.lastActivityAt) : undefined;
    if (lastActive !== undefined && lastActive < options.since) continue;
    let messageHistory = bridgeSession.messageHistory;
    if (bridgeSession.searchDataOnly) {
      if (!options.loadArchived) continue;
      try {
        messageHistory = (await ctx.sessionStore.load(session.sessionId))?.messageHistory ?? [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[takode-activity] Cannot load archived session ${session.sessionId}: ${message}`);
        unreadable.push({ session: ctx.launcher.getSessionNum(session.sessionId) ?? null, error: message });
        continue;
      }
    }
    const name = sessionNames.getName(session.sessionId) ?? session.name ?? session.sessionId.slice(0, 8);
    const rootNum = sideChat ? ctx.launcher.getSessionNum(sideChat.rootSessionId) : undefined;
    documents.push({
      sessionId: session.sessionId,
      sessionNum: ctx.launcher.getSessionNum(session.sessionId) ?? null,
      sessionName: sideChat ? `Side chat of #${rootNum ?? sideChat.rootSessionId.slice(0, 8)}` : name,
      space,
      isOrchestrator: session.isOrchestrator === true || bridgeSession.state.isOrchestrator === true,
      messageHistory,
    });
  }
  return { documents, unreadable };
}
