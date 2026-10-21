import {
  buildSessionActivityRecord,
  type ActivitySessionDocument,
  type SessionActivityRecord,
} from "./activity-stream.js";
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
 * null) that may have been active since `since`. Sessions archived before this server started keep
 * their history only on disk and are read from the activity record saved when they were archived;
 * one without a record is loaded from disk (and its record saved) with `loadArchived`, else skipped.
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
    const isOrchestrator = session.isOrchestrator === true || bridgeSession.state.isOrchestrator === true;
    const name = sessionNames.getName(session.sessionId) ?? session.name ?? session.sessionId.slice(0, 8);
    const rootNum = sideChat ? ctx.launcher.getSessionNum(sideChat.rootSessionId) : undefined;
    const document = {
      sessionId: session.sessionId,
      sessionNum: ctx.launcher.getSessionNum(session.sessionId) ?? null,
      sessionName: sideChat ? `Side chat of #${rootNum ?? sideChat.rootSessionId.slice(0, 8)}` : name,
      space,
      isOrchestrator,
    };
    if (!bridgeSession.searchDataOnly) {
      documents.push({ ...document, messageHistory: bridgeSession.messageHistory });
      continue;
    }
    // Sessions archived before this server started keep their history only on disk; their activity
    // record, saved at archive time, replaces it.
    const record = await savedActivityRecord(ctx, session.sessionId);
    if (record?.isOrchestrator === isOrchestrator) {
      documents.push({ ...document, activity: record });
      continue;
    }
    if (!options.loadArchived) continue;
    try {
      const messageHistory = (await ctx.sessionStore.load(session.sessionId))?.messageHistory ?? [];
      documents.push({ ...document, messageHistory });
      // Saved now, so this history is read from disk only once.
      await saveActivityRecord(ctx, session.sessionId, buildSessionActivityRecord(messageHistory, isOrchestrator));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[takode-activity] Cannot load archived session ${session.sessionId}: ${message}`);
      unreadable.push({ session: ctx.launcher.getSessionNum(session.sessionId) ?? null, error: message });
    }
  }
  return { documents, unreadable };
}

/**
 * Save the activity records of sessions archived before records existed, so `takode activity` stops
 * reading their whole histories. One session at a time, pausing between them, so it never loads the
 * server noticeably; stops when `shouldStop` turns true. Returns how many records it saved.
 */
export async function backfillActivityRecords(
  ctx: SessionSources,
  options: { pauseMs: number; shouldStop: () => boolean },
): Promise<number> {
  let saved = 0;
  for (const session of ctx.launcher.listSessions()) {
    if (options.shouldStop()) break;
    const bridgeSession = ctx.wsBridge.getSession(session.sessionId);
    if (!bridgeSession?.searchDataOnly) continue;
    if (await savedActivityRecord(ctx, session.sessionId)) continue;
    const isOrchestrator = session.isOrchestrator === true || bridgeSession.state.isOrchestrator === true;
    try {
      const persisted = await ctx.sessionStore.load(session.sessionId);
      if (!persisted) continue;
      await saveActivityRecord(
        ctx,
        session.sessionId,
        buildSessionActivityRecord(persisted.messageHistory, isOrchestrator),
      );
      saved++;
    } catch (error) {
      console.warn(`[takode-activity] Cannot build the activity record of ${session.sessionId}:`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
  }
  return saved;
}

/** A saved record that cannot be read counts as missing: the session's history is read instead. */
async function savedActivityRecord(ctx: SessionSources, sessionId: string): Promise<SessionActivityRecord | null> {
  try {
    return await ctx.sessionStore.loadActivityRecord(sessionId);
  } catch (error) {
    console.warn(`[takode-activity] Cannot read the activity record of ${sessionId}:`, error);
    return null;
  }
}

async function saveActivityRecord(ctx: SessionSources, sessionId: string, record: SessionActivityRecord) {
  await ctx.sessionStore
    .saveActivityRecord(sessionId, record)
    .catch((error) => console.warn(`[takode-activity] Cannot save the activity record of ${sessionId}:`, error));
}
