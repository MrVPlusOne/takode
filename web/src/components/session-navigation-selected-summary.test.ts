// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SESSION_NAVIGATION_PROJECTION } from "../../shared/session-navigation-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { createSessionNavigationProjectionValue } from "../test-fixtures/session-navigation-projection.js";
import type { SdkSessionInfo, SessionState } from "../types.js";
import {
  resolveSessionNavigation,
  type SessionNavigationResolverSource,
} from "../utils/session-navigation-resolver.js";
import {
  participantNavigationMatchesSessionNum,
  resolveChatSessionNavigationSummary,
  resolveQuestBannerParticipantIdentity,
} from "./ChatView.js";
import { resolveParticipantSessionStatusDotProps } from "./session-participant-status.js";
import { resolveWorkBoardIsOrchestrator } from "./WorkBoardBar.js";

function source(
  value = createSessionNavigationProjectionValue(),
  {
    sdk = {},
    session = {},
    projected = true,
  }: {
    sdk?: Partial<SdkSessionInfo>;
    session?: Partial<SessionState>;
    projected?: boolean;
  } = {},
): SessionNavigationResolverSource {
  const entryId = syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1");
  return {
    sessions: new Map([
      [
        "s1",
        {
          session_id: "s1",
          isOrchestrator: false,
          claimedQuestId: "q-stale-state",
          claimedQuestTitle: "Stale state title",
          claimedQuestStatus: "done",
          claimedQuestLeaderSessionId: "leader-stale-state",
          ...session,
        } as SessionState,
      ],
    ]),
    sdkSessions: [
      {
        sessionId: "s1",
        state: "connected",
        cwd: "/legacy",
        createdAt: 1,
        name: "Stale SDK name",
        sessionNum: 7,
        isOrchestrator: false,
        herdedBy: "leader-stale-sdk",
        claimedQuestId: "q-stale-sdk",
        claimedQuestTitle: "Stale SDK title",
        claimedQuestStatus: "done",
        claimedQuestLeaderSessionId: "leader-stale-sdk",
        ...sdk,
      },
    ],
    syncedProjectionValues: projected ? new Map([[entryId, value]]) : new Map(),
    syncedProjectionKeys: projected ? new Set([entryId]) : new Set(),
  };
}

describe("selected session-navigation consumers", () => {
  it("uses the projection for ChatView, WorkBoardBar, and quest-banner participant identity", () => {
    const state = source(
      createSessionNavigationProjectionValue({
        identity: { name: "Projected Worker", sessionNum: 42 },
        topology: { isOrchestrator: true, herdedBy: "leader-projected" },
        quest: {
          claimedQuestId: "q-projected",
          claimedQuestTitle: "Projected quest",
          claimedQuestStatus: "in_progress",
          claimedQuestLeaderSessionId: "leader-projected",
        },
      }),
    );

    expect(resolveChatSessionNavigationSummary(state, "s1")).toEqual({
      isLeaderSession: true,
      sessionNum: 42,
      claimedQuestId: "q-projected",
      claimedQuestTitle: "Projected quest",
      claimedQuestStatus: "in_progress",
      claimedQuestLeaderSessionId: "leader-projected",
      herdedBy: "leader-projected",
    });
    expect(resolveWorkBoardIsOrchestrator(state, "s1")).toBe(true);
    expect(
      resolveQuestBannerParticipantIdentity(resolveSessionNavigation(state, "s1"), 7, "Stale participant name"),
    ).toEqual({ sessionNum: 42, displayName: "Projected Worker" });
    expect(participantNavigationMatchesSessionNum(resolveSessionNavigation(state, "s1"), 7, 7)).toBe(false);
    expect(participantNavigationMatchesSessionNum(resolveSessionNavigation(state, "s1"), 7, 42)).toBe(true);
  });

  it("treats explicit projected clears as authoritative instead of reviving stale summaries", () => {
    const state = source(
      createSessionNavigationProjectionValue({
        identity: { name: null, sessionNum: null },
        topology: { isOrchestrator: false, herdedBy: null },
        quest: {
          claimedQuestId: null,
          claimedQuestTitle: null,
          claimedQuestStatus: null,
          claimedQuestLeaderSessionId: null,
        },
      }),
      {
        sdk: { isOrchestrator: true, name: "Stale name", sessionNum: 7 },
        session: { isOrchestrator: true },
      },
    );

    expect(resolveChatSessionNavigationSummary(state, "s1")).toEqual({
      isLeaderSession: false,
      sessionNum: null,
      claimedQuestId: null,
      claimedQuestTitle: null,
      claimedQuestStatus: null,
      claimedQuestLeaderSessionId: null,
      herdedBy: null,
    });
    expect(resolveWorkBoardIsOrchestrator(state, "s1")).toBe(false);
    expect(resolveQuestBannerParticipantIdentity(resolveSessionNavigation(state, "s1"), 7, "Stale name")).toEqual({
      sessionNum: undefined,
      displayName: undefined,
    });
  });

  it("uses projected lifecycle, permission, and timer summaries for participant status", () => {
    const state = source(
      createSessionNavigationProjectionValue({
        lifecycle: {
          sdkState: "running",
          status: "compacting",
          cliConnected: true,
          idleKilled: false,
          pendingPermissionCount: 3,
          pendingTimerCount: 2,
        },
      }),
    );

    expect(
      resolveParticipantSessionStatusDotProps({
        navigation: resolveSessionNavigation(state, "s1"),
        sdkSession: state.sdkSessions[0],
        hasSessionStatus: true,
        liveStatus: "running",
        hasCliConnected: true,
        cliConnected: false,
        disconnectReason: "idle_limit",
        rawPermissionCount: 9,
        hasUnread: true,
        isCurrentSession: true,
        liveTimerCount: 8,
        fallbackStatus: "archived",
      }),
    ).toMatchObject({
      archived: false,
      permCount: 3,
      isConnected: true,
      sdkState: "running",
      status: "compacting",
      hasUnread: true,
      idleKilled: false,
      activeTimerCount: 2,
    });
  });

  it("keeps legacy fallback behavior when navigation projection authority is unavailable", () => {
    const state = source(createSessionNavigationProjectionValue(), {
      projected: false,
      sdk: { isOrchestrator: true, sessionNum: 7, name: "Legacy name" },
      session: { claimedQuestId: "q-legacy", claimedQuestTitle: "Legacy quest" },
    });

    expect(resolveChatSessionNavigationSummary(state, "s1")).toMatchObject({
      isLeaderSession: true,
      sessionNum: 7,
      claimedQuestId: "q-legacy",
      claimedQuestTitle: "Legacy quest",
    });
    expect(resolveWorkBoardIsOrchestrator(state, "s1")).toBe(true);
    expect(resolveQuestBannerParticipantIdentity(resolveSessionNavigation(state, "s1"), 7, "Board name")).toEqual({
      sessionNum: 7,
      displayName: "Board name",
    });
    expect(participantNavigationMatchesSessionNum(resolveSessionNavigation(state, "s1"), 7, 7)).toBe(true);
  });
});
