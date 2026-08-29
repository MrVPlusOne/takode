// @vitest-environment jsdom
import { waitFor } from "@testing-library/dom";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  absoluteUrlForHash,
  hasMessageDeepLinkFromHash,
  messageIdFromHash,
  messageIndexFromHash,
  parseHash,
  resolveSessionIdFromRoute,
  retireSessionMessageRoute,
  sessionHash,
  sessionMessageHash,
  sessionThreadHash,
  scrollToMessageIndex,
  navigateToSession,
  navigateToSessionMessageId,
  navigateToSessionThread,
  navigateHome,
  navigateToMostRecentSession,
  openQuestOverlayRouteAware,
  questIdFromHash,
  questOverlayTargetFromHash,
  threadRouteFromHash,
  withQuestFeedbackInHash,
  withQuestIdInHash,
  withThreadKeyInHash,
  withoutQuestIdInHash,
  playgroundSectionIdFromHash,
  withPlaygroundSectionInHash,
  withoutPlaygroundSectionInHash,
} from "./routing.js";
import { useStore } from "../store.js";

describe("parseHash", () => {
  it("returns home for empty string", () => {
    expect(parseHash("")).toEqual({ page: "home" });
  });

  it("returns home for bare hash", () => {
    expect(parseHash("#/")).toEqual({ page: "home" });
  });

  it("returns home for unknown routes", () => {
    expect(parseHash("#/unknown")).toEqual({ page: "home" });
  });

  it("parses settings route", () => {
    expect(parseHash("#/settings")).toEqual({ page: "settings" });
  });

  it("parses changelog route", () => {
    // The changelog viewer has a dedicated route so Settings state can be restored via normal Back navigation.
    expect(parseHash("#/changelog")).toEqual({ page: "changelog" });
  });

  it("parses logs route", () => {
    // The dedicated log viewer lives at its own top-level route so settings deep-links stay stable.
    expect(parseHash("#/logs")).toEqual({ page: "logs" });
  });

  it("parses terminal route", () => {
    expect(parseHash("#/terminal")).toEqual({ page: "terminal" });
  });

  it("parses environments route", () => {
    expect(parseHash("#/environments")).toEqual({ page: "environments" });
  });

  it("parses scheduled route", () => {
    expect(parseHash("#/scheduled")).toEqual({ page: "scheduled" });
  });

  it("parses memory route", () => {
    expect(parseHash("#/memory")).toEqual({ page: "memory" });
  });

  it("treats the legacy streams route as memory", () => {
    expect(parseHash("#/streams")).toEqual({ page: "memory" });
  });

  it("parses playground route", () => {
    expect(parseHash("#/playground")).toEqual({ page: "playground" });
  });

  it("parses questmaster route with query params", () => {
    expect(parseHash("#/questmaster?quest=q-67")).toEqual({ page: "questmaster" });
  });

  it("parses session route with UUID", () => {
    expect(parseHash("#/session/a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toEqual({
      page: "session",
      sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
  });

  it("parses session route with short ID", () => {
    expect(parseHash("#/session/abc123")).toEqual({
      page: "session",
      sessionId: "abc123",
    });
  });

  it("parses session route with query params", () => {
    expect(parseHash("#/session/abc123?quest=q-42")).toEqual({
      page: "session",
      sessionId: "abc123",
    });
  });

  it("parses session route with a stable message ID in the path", () => {
    expect(parseHash("#/session/123/msg/asst-42")).toEqual({
      page: "session",
      sessionId: "123",
      messageId: "asst-42",
    });
  });

  it("parses session route with a readable message index in the path", () => {
    expect(parseHash("#/session/123/msg/42")).toEqual({
      page: "session",
      sessionId: "123",
      messageIndex: 42,
    });
  });

  it("returns home for session route with empty ID", () => {
    // #/session/ with no ID should be treated as home
    expect(parseHash("#/session/")).toEqual({ page: "home" });
  });
});

describe("quest hash helpers", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState({}, "", "/#/session/s1");
  });

  it("extracts coupled whole-quest and exact-feedback targets from any route query", () => {
    expect(questOverlayTargetFromHash("#/session/s1?quest=q-42&feedback=5")).toEqual({
      questId: "q-42",
      feedbackIndex: 5,
    });
    expect(questOverlayTargetFromHash("#/questmaster?quest=Q-8")).toEqual({ questId: "q-8" });
    expect(questOverlayTargetFromHash("#/session/s1?quest=q-42&feedback=nope")).toEqual({ questId: "q-42" });
    expect(questOverlayTargetFromHash("#/session/s1?quest=oops&feedback=5")).toBeNull();
    expect(questIdFromHash("#/session/s1?quest=q-42&feedback=5")).toBe("q-42");
  });

  it("builds exact-feedback routes while preserving message, thread, and unrelated params", () => {
    expect(withQuestFeedbackInHash("#/session/s1/msg/m-7?thread=q-9&foo=1", "q-12", 5)).toBe(
      "#/session/s1/msg/m-7?thread=q-9&foo=1&quest=q-12&feedback=5",
    );
  });

  it("adds whole-quest routes and clears stale feedback targets", () => {
    expect(withQuestIdInHash("#/session/s1", "q-12")).toBe("#/session/s1?quest=q-12");
    expect(withQuestIdInHash("#/session/s1?foo=1&quest=q-7&feedback=3", "q-12")).toBe("#/session/s1?foo=1&quest=q-12");
  });

  it("removes coupled quest and feedback query params while preserving others", () => {
    expect(withoutQuestIdInHash("#/session/s1?foo=1&quest=q-12&feedback=5&bar=2")).toBe("#/session/s1?foo=1&bar=2");
    expect(withoutQuestIdInHash("#/session/s1?feedback=5&quest=q-12")).toBe("#/session/s1");
  });

  it("keeps whole-quest overlay opens store-only when the hash has no quest route", () => {
    openQuestOverlayRouteAware("q-77", "needle");

    expect(useStore.getState().questOverlayId).toBe("q-77");
    expect(useStore.getState().questOverlaySearchHighlight).toBe("needle");
    expect(window.location.hash).toBe("#/session/s1");
  });

  it("replaces an existing routed feedback target when another overlay opens", () => {
    window.history.replaceState({}, "", "/#/session/s1/msg/m-7?thread=q-9&quest=q-12&feedback=5");

    openQuestOverlayRouteAware("q-77");

    expect(useStore.getState().questOverlayId).toBe("q-77");
    expect(useStore.getState().questOverlayFeedbackTarget).toBeNull();
    expect(window.location.hash).toBe("#/session/s1/msg/m-7?thread=q-9&quest=q-77");
  });
});

describe("leader thread hash helpers", () => {
  it("extracts normalized leader thread state from session query params", () => {
    expect(threadRouteFromHash("#/session/s1")).toEqual({ hasThreadParam: false, threadKey: null });
    expect(threadRouteFromHash("#/session/s1?thread=Q-42")).toEqual({ hasThreadParam: true, threadKey: "q-42" });
    expect(threadRouteFromHash("#/session/s1?thread=all")).toEqual({ hasThreadParam: true, threadKey: "all" });
    expect(threadRouteFromHash("#/session/s1?thread=oops")).toEqual({ hasThreadParam: true, threadKey: null });
  });

  it("updates the leader thread query while preserving the route and other params", () => {
    expect(withThreadKeyInHash("#/session/s1", "q-12")).toBe("#/session/s1?thread=q-12");
    expect(withThreadKeyInHash("#/session/41/msg/alpha-thread-target", "q-1177")).toBe(
      "#/session/41/msg/alpha-thread-target?thread=q-1177",
    );
    expect(withThreadKeyInHash("#/session/123?quest=q-7", "all")).toBe("#/session/123?quest=q-7&thread=all");
    expect(withThreadKeyInHash("#/session/s1?thread=q-12&quest=q-7", "main")).toBe("#/session/s1?quest=q-7");
  });
});

describe("playground hash helpers", () => {
  it("extracts the playground section from the route query", () => {
    expect(playgroundSectionIdFromHash("#/playground?section=states-timer-messages")).toBe("states-timer-messages");
    expect(playgroundSectionIdFromHash("#/playground?section=interactive-composer&foo=1")).toBe("interactive-composer");
    expect(playgroundSectionIdFromHash("#/session/s1?section=states-timer-messages")).toBeNull();
  });

  it("adds the playground section query while preserving the route and existing params", () => {
    expect(withPlaygroundSectionInHash("#/playground", "states-timer-messages")).toBe(
      "#/playground?section=states-timer-messages",
    );
    expect(withPlaygroundSectionInHash("#/playground?foo=1", "interactive-composer")).toBe(
      "#/playground?foo=1&section=interactive-composer",
    );
  });

  it("removes the playground section query while preserving other params", () => {
    expect(withoutPlaygroundSectionInHash("#/playground?foo=1&section=states-timer-messages&bar=2")).toBe(
      "#/playground?foo=1&bar=2",
    );
    expect(withoutPlaygroundSectionInHash("#/playground?section=states-timer-messages")).toBe("#/playground");
  });
});

describe("sessionHash", () => {
  it("builds hash for a session ID", () => {
    expect(sessionHash("abc123")).toBe("#/session/abc123");
  });

  it("builds hash for a UUID session ID", () => {
    expect(sessionHash("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("#/session/a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("builds hash for a session number", () => {
    expect(sessionHash(123)).toBe("#/session/123");
  });
});

describe("sessionThreadHash", () => {
  it("builds a session hash with optional normalized leader thread context", () => {
    expect(sessionThreadHash(123, "Q-42")).toBe("#/session/123?thread=q-42");
    expect(sessionThreadHash("abc123", "main")).toBe("#/session/abc123");
    expect(sessionThreadHash("abc123", null)).toBe("#/session/abc123");
  });
});

describe("sessionMessageHash", () => {
  it("builds a readable message-index path under the session route", () => {
    expect(sessionMessageHash(123, 42)).toBe("#/session/123/msg/42");
  });
});

describe("messageIdFromHash", () => {
  it("reads the stable message ID from the session path", () => {
    expect(messageIdFromHash("#/session/123/msg/asst-42")).toBe("asst-42");
    expect(messageIdFromHash("#/session/41/msg/alpha-thread-target?thread=q-1177")).toBe("alpha-thread-target");
    expect(messageIdFromHash("#/session/123/msg/42")).toBeNull();
    expect(messageIdFromHash("#/session/123?msg=42")).toBeNull();
  });
});

describe("messageIndexFromHash", () => {
  it("reads the readable message index from the session path", () => {
    expect(messageIndexFromHash("#/session/123/msg/42")).toBe(42);
  });

  it("falls back to the legacy query parameter", () => {
    expect(messageIndexFromHash("#/session/123?msg=42")).toBe(42);
  });

  it("ignores opaque message IDs", () => {
    expect(messageIndexFromHash("#/session/123/msg/asst-42")).toBeNull();
  });
});

describe("hasMessageDeepLinkFromHash", () => {
  it("recognizes message-specific routes while preserving thread query parsing", () => {
    expect(hasMessageDeepLinkFromHash("#/session/41/msg/alpha-thread-target?thread=q-1177")).toBe(true);
    expect(threadRouteFromHash("#/session/41/msg/alpha-thread-target?thread=q-1177")).toEqual({
      hasThreadParam: true,
      threadKey: "q-1177",
    });
    expect(hasMessageDeepLinkFromHash("#/session/41/msg/12?thread=q-1177")).toBe(true);
    expect(hasMessageDeepLinkFromHash("#/session/41?msg=12&thread=q-1177")).toBe(true);
    expect(hasMessageDeepLinkFromHash("#/session/41?thread=q-1177")).toBe(false);
  });
});

describe("scrollToMessageIndex", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("resolves readable indexes against raw messageHistory indexes before rendered array positions", () => {
    // Rendered position 1 corresponds to raw messageHistory index 2 when
    // messageHistory[1] was a non-rendered tool_result_preview.
    useStore.getState().setMessages("s1", [
      { id: "u0", role: "user", content: "Prompt", timestamp: 100, historyIndex: 0 },
      { id: "a2", role: "assistant", content: "Answer", timestamp: 200, historyIndex: 2 },
    ]);

    scrollToMessageIndex("s1", 2);

    expect(useStore.getState().scrollToMessageId.get("s1")).toBe("a2");
    expect(useStore.getState().expandAllInTurn.get("s1")).toBe("a2");
  });

  it("leaves raw-index scroll pending instead of falling back to rendered position on partial history", () => {
    useStore.getState().setMessages("s1", [
      { id: "u50", role: "user", content: "Prompt", timestamp: 100, historyIndex: 50 },
      { id: "a52", role: "assistant", content: "Answer", timestamp: 200, historyIndex: 52 },
    ]);

    scrollToMessageIndex("s1", 1);

    expect(useStore.getState().scrollToMessageId.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingScrollToMessageIndex.get("s1")).toBe(1);
  });
});

describe("resolveSessionIdFromRoute", () => {
  it("passes through UUID-style session IDs", () => {
    expect(resolveSessionIdFromRoute("session-abc", [])).toBe("session-abc");
  });

  it("resolves numeric session routes through sdk session numbers", () => {
    expect(
      resolveSessionIdFromRoute("123", [
        { sessionId: "session-abc", createdAt: 1, state: "connected", cwd: "/repo", sessionNum: 123 },
      ]),
    ).toBe("session-abc");
  });

  it("returns null when a numeric session route cannot be resolved", () => {
    expect(resolveSessionIdFromRoute("123", [])).toBeNull();
  });
});

describe("absoluteUrlForHash", () => {
  it("preserves the current server origin and pathname while swapping the hash", () => {
    history.replaceState(null, "", "/takode?foo=1#/session/s1");
    expect(absoluteUrlForHash("#/session/123/msg/asst-42")).toBe(
      "http://localhost:3000/takode?foo=1#/session/123/msg/asst-42",
    );
  });
});

describe("navigateToSession", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("sets hash to session route", () => {
    navigateToSession("test-id");
    expect(window.location.hash).toBe("#/session/test-id");
  });

  it("uses replaceState when replace=true", () => {
    const spy = vi.spyOn(history, "replaceState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateToSession("test-id", true);
    expect(spy).toHaveBeenCalledWith(null, "", "#/session/test-id");
    // Should dispatch hashchange since replaceState doesn't trigger it natively
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(HashChangeEvent));
    spy.mockRestore();
    dispatchSpy.mockRestore();
  });
});

describe("navigateToSessionThread", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("adds browser history entries for user-initiated leader thread changes", async () => {
    window.location.hash = "#/session/s1";

    navigateToSessionThread("s1", "q-941");
    expect(window.location.hash).toBe("#/session/s1?thread=q-941");

    navigateToSessionThread("s1", "all");
    expect(window.location.hash).toBe("#/session/s1?thread=all");

    history.back();
    await waitFor(() => {
      expect(window.location.hash).toBe("#/session/s1?thread=q-941");
    });

    history.forward();
    await waitFor(() => {
      expect(window.location.hash).toBe("#/session/s1?thread=all");
    });
  });

  it("uses replaceState for passive thread route normalization", () => {
    window.location.hash = "#/session/s1?thread=oops";
    const spy = vi.spyOn(history, "replaceState");

    navigateToSessionThread("s1", "main", true);

    expect(spy).toHaveBeenCalledWith(null, "", "#/session/s1");
    expect(window.location.hash).toBe("#/session/s1");
    spy.mockRestore();
  });

  it("does not reuse a different session route when changing thread state", () => {
    window.location.hash = "#/session/s1";

    navigateToSessionThread("s2", "q-941");

    expect(window.location.hash).toBe("#/session/s2?thread=q-941");
  });

  it("preserves numeric routes when they resolve to the target session", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "resolved-session", createdAt: 1, state: "connected", cwd: "/repo", sessionNum: 123 } as any,
      ],
    });
    window.location.hash = "#/session/123?quest=q-7";

    navigateToSessionThread("resolved-session", "q-941");

    expect(window.location.hash).toBe("#/session/123?quest=q-7&thread=q-941");
  });

  it("uses the supplied route session reference when opening another session thread", () => {
    window.location.hash = "#/session/s1";

    navigateToSessionThread("resolved-session", "q-941", false, 123);

    expect(window.location.hash).toBe("#/session/123?thread=q-941");
  });
});

describe("navigateToSessionMessageId", () => {
  beforeEach(() => {
    window.location.hash = "";
    useStore.getState().reset();
  });

  it("preserves leader thread context when opening a stable message route", () => {
    navigateToSessionMessageId("validation-alpha", "alpha-thread-target", {
      routeSessionId: 41,
      threadKey: "q-1177",
    });

    expect(window.location.hash).toBe("#/session/41/msg/alpha-thread-target?thread=q-1177");
    expect(useStore.getState().scrollToMessageId.get("validation-alpha")).toBe("alpha-thread-target");
    expect(useStore.getState().expandAllInTurn.get("validation-alpha")).toBe("alpha-thread-target");
  });

  it("preserves explicit Main thread context for stable message routes", () => {
    navigateToSessionMessageId("validation-alpha", "alpha-main-target", {
      routeSessionId: 41,
      threadKey: "main",
      preserveMainThreadRoute: true,
    });

    expect(window.location.hash).toBe("#/session/41/msg/alpha-main-target?thread=main");
    expect(useStore.getState().scrollToMessageId.get("validation-alpha")).toBe("alpha-main-target");
  });
});

describe("retireSessionMessageRoute", () => {
  beforeEach(() => {
    history.replaceState(null, "", "#/session/start");
    useStore.getState().reset();
  });

  it("replaces a consumed stable message route while preserving session and query context", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "resolved-session", sessionNum: 41, createdAt: 1 } as any],
    });
    history.replaceState(null, "", "#/session/41/msg/search-target?thread=main&quest=q-7");
    const historyLength = history.length;
    const replaceSpy = vi.spyOn(history, "replaceState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    expect(retireSessionMessageRoute("resolved-session")).toBe(true);

    expect(replaceSpy).toHaveBeenCalledWith(null, "", "#/session/41?thread=main&quest=q-7");
    expect(window.location.hash).toBe("#/session/41?thread=main&quest=q-7");
    expect(history.length).toBe(historyLength);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(HashChangeEvent));
    replaceSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it("retires legacy readable-index targets and allows a fresh same-message navigation", () => {
    history.replaceState(null, "", "#/session/s1?thread=q-7&msg=42");

    expect(retireSessionMessageRoute("s1")).toBe(true);
    expect(window.location.hash).toBe("#/session/s1?thread=q-7");

    navigateToSessionMessageId("s1", "stable-target", { threadKey: "q-7" });
    expect(window.location.hash).toBe("#/session/s1/msg/stable-target?thread=q-7");
    expect(useStore.getState().scrollToMessageId.get("s1")).toBe("stable-target");
  });

  it("does not rewrite another session or a route without a message target", () => {
    history.replaceState(null, "", "#/session/s1/msg/search-target?thread=main");
    expect(retireSessionMessageRoute("s2")).toBe(false);
    expect(window.location.hash).toContain("/msg/search-target");

    history.replaceState(null, "", "#/session/s1/msg/search-target?thread=q-7");
    expect(retireSessionMessageRoute("s1", "main")).toBe(false);
    expect(window.location.hash).toContain("/msg/search-target");

    history.replaceState(null, "", "#/session/s1?thread=main");
    expect(retireSessionMessageRoute("s1")).toBe(false);
    expect(window.location.hash).toBe("#/session/s1?thread=main");
  });
});

describe("navigateHome", () => {
  beforeEach(() => {
    window.location.hash = "#/session/test";
  });

  it("clears the hash", () => {
    navigateHome();
    // After clearing, hash is empty string (browser may keep "#" or "")
    expect(window.location.hash === "" || window.location.hash === "#").toBe(true);
  });

  it("uses replaceState when replace=true", () => {
    const spy = vi.spyOn(history, "replaceState");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    navigateHome(true);
    expect(spy).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(HashChangeEvent));
    spy.mockRestore();
    dispatchSpy.mockRestore();
  });
});

describe("navigateToMostRecentSession", () => {
  beforeEach(() => {
    window.location.hash = "";
    useStore.setState({ sdkSessions: [] });
  });

  it("navigates to the most recent non-archived session", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "old", createdAt: 1000, archived: false } as any,
        { sessionId: "new", createdAt: 2000, archived: false } as any,
      ],
    });

    const result = navigateToMostRecentSession();

    expect(result).toBe(true);
    expect(window.location.hash).toBe("#/session/new");
  });

  it("skips archived sessions", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "active", createdAt: 1000, archived: false } as any,
        { sessionId: "archived", createdAt: 2000, archived: true } as any,
      ],
    });

    const result = navigateToMostRecentSession();

    expect(result).toBe(true);
    expect(window.location.hash).toBe("#/session/active");
  });

  it("skips cron job sessions", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "regular", createdAt: 1000, archived: false } as any,
        { sessionId: "cron", createdAt: 2000, archived: false, cronJobId: "cron-1" } as any,
      ],
    });

    const result = navigateToMostRecentSession();

    expect(result).toBe(true);
    expect(window.location.hash).toBe("#/session/regular");
  });

  it("excludes the specified session ID", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "keep", createdAt: 1000, archived: false } as any,
        { sessionId: "exclude", createdAt: 2000, archived: false } as any,
      ],
    });

    const result = navigateToMostRecentSession({ excludeId: "exclude" });

    expect(result).toBe(true);
    expect(window.location.hash).toBe("#/session/keep");
  });

  it("excludes a set of session IDs", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "keep", createdAt: 1000, archived: false } as any,
        { sessionId: "archived-leader", createdAt: 3000, archived: false } as any,
        { sessionId: "archived-worker", createdAt: 2000, archived: false } as any,
      ],
    });

    const result = navigateToMostRecentSession({ excludeIds: new Set(["archived-leader", "archived-worker"]) });

    expect(result).toBe(true);
    expect(window.location.hash).toBe("#/session/keep");
  });

  it("falls back to home when no sessions exist", () => {
    useStore.setState({ sdkSessions: [] });

    const result = navigateToMostRecentSession();

    expect(result).toBe(false);
    expect(window.location.hash === "" || window.location.hash === "#").toBe(true);
  });

  it("falls back to home when all sessions are archived", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "a", createdAt: 1000, archived: true } as any],
    });

    const result = navigateToMostRecentSession();

    expect(result).toBe(false);
  });
});
