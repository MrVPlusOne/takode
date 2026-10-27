// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SHORTCUT_SETTINGS,
  SHORTCUT_ACTIONS,
  createShortcutGestureRecorder,
  findShortcutBindingConflict,
  formatShortcut,
  getMatchingShortcutAction,
  getEffectiveShortcutBinding,
  getMatchingShortcutTapAction,
  getShortcutHint,
  isAppGlobalShortcutAction,
  performShortcutAction,
  recordShortcutBindingFromEvent,
  resolveShortcutNewSessionContext,
  shouldBlurVimEscape,
  type ShortcutRuntime,
} from "./shortcuts.js";

describe("shortcuts", () => {
  it("describes both Recent browsing and the searchable Universal Search modes", () => {
    expect(SHORTCUT_ACTIONS.find((action) => action.id === "search_session")?.description).toBe(
      "Browse recent conversations or search quests, sessions, current-session messages, and starred results.",
    );
  });

  it("stays disabled by default", () => {
    expect(
      getMatchingShortcutAction(DEFAULT_SHORTCUT_SETTINGS, {
        key: "f",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(getShortcutHint(DEFAULT_SHORTCUT_SETTINGS, "search_session", "MacIntel")).toBeNull();
  });

  it("matches preset bindings when enabled", () => {
    const action = getMatchingShortcutAction(
      { enabled: true, preset: "vscode-light", typeToCompose: true, overrides: {} },
      { key: "`", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
    );

    expect(action).toBe("open_terminal");
    expect(formatShortcut("Ctrl+`", "MacIntel")).toBe("Ctrl+`");
  });

  it("uses Ctrl/Cmd+Shift+F for the Standard Universal Search shortcut", () => {
    const settings = { enabled: true, preset: "standard" as const, typeToCompose: true, overrides: {} };

    expect(getShortcutHint(settings, "search_session", "MacIntel")).toBe("Cmd+Shift+F");
    expect(getShortcutHint(settings, "search_session", "Linux x86_64")).toBe("Ctrl+Shift+F");
    expect(
      getMatchingShortcutAction(settings, {
        key: "f",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe("search_session");
    expect(
      getMatchingShortcutAction(settings, {
        key: "f",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it("includes voice start and stop in preset shortcuts", () => {
    const settings = { enabled: true, preset: "standard" as const, typeToCompose: true, overrides: {} };

    expect(getShortcutHint(settings, "voice_start", "MacIntel")).toBe("Double Shift");
    expect(getShortcutHint(settings, "voice_stop", "MacIntel")).toBe("Shift");
    expect(getMatchingShortcutTapAction(settings, "Shift", 2)).toBe("voice_start");
    expect(getMatchingShortcutTapAction(settings, "Shift", 1)).toBe("voice_stop");
    expect(
      getMatchingShortcutTapAction(
        { enabled: true, preset: "standard", typeToCompose: true, overrides: { voice_stop: "Tap:Ctrl" } },
        "Control",
        1,
      ),
    ).toBe("voice_stop");
  });

  it("keeps tap gestures out of keydown chord matching", () => {
    const settings = { enabled: true, preset: "standard" as const, typeToCompose: true, overrides: {} };

    expect(
      getMatchingShortcutAction(settings, {
        key: "Shift",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBeNull();
  });

  it("records modifier-only single taps distinctly from double taps", () => {
    vi.useFakeTimers();
    try {
      const bindings: string[] = [];
      const recorder = createShortcutGestureRecorder((binding) => bindings.push(binding));

      recorder.keyDown({ key: "Shift", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true, repeat: false });
      recorder.keyUp({ key: "Shift" });
      expect(bindings).toEqual([]);

      vi.advanceTimersByTime(400);
      expect(bindings).toEqual(["Tap:Shift"]);

      recorder.keyDown({ key: "Shift", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true, repeat: false });
      recorder.keyUp({ key: "Shift" });
      vi.advanceTimersByTime(200);
      recorder.keyDown({ key: "Shift", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true, repeat: false });
      recorder.keyUp({ key: "Shift" });

      expect(bindings).toEqual(["Tap:Shift", "DoubleTap:Shift"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still records chord shortcuts immediately", () => {
    expect(
      recordShortcutBindingFromEvent({
        key: "l",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("Ctrl+L");

    const bindings: string[] = [];
    const recorder = createShortcutGestureRecorder((binding) => bindings.push(binding));
    recorder.keyDown({ key: "l", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false, repeat: false });

    expect(bindings).toEqual(["Ctrl+L"]);
  });

  it("reports a held modifier so a key the browser swallowed can be told apart", () => {
    // Browsers keep Cmd+N for themselves: the page sees Cmd go down and nothing else.
    const recorder = createShortcutGestureRecorder(() => {});
    expect(recorder.isHoldingModifier()).toBe(false);
    recorder.keyDown({ key: "Meta", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false, repeat: false });
    expect(recorder.isHoldingModifier()).toBe(true);
    recorder.cancel();
    expect(recorder.isHoldingModifier()).toBe(false);
  });

  it("finds the action already using a recorded shortcut", () => {
    const standard = { enabled: true, preset: "standard" as const, typeToCompose: true, overrides: {} };
    // Mod is Cmd on Mac, so a recorded Cmd+N collides with the preset's Mod+N for New Session.
    expect(findShortcutBindingConflict(standard, "next_attention", "Cmd+N", "MacIntel")).toBe("new_session");
    expect(findShortcutBindingConflict(standard, "next_attention", "Ctrl+N", "MacIntel")).toBeNull();
    // Mod is Ctrl elsewhere.
    expect(findShortcutBindingConflict(standard, "next_attention", "Ctrl+N", "Linux x86_64")).toBe("new_session");
    // An action never conflicts with itself, so re-recording its own keys is fine.
    expect(findShortcutBindingConflict(standard, "new_session", "Cmd+N", "MacIntel")).toBeNull();
    // A single tap and a double tap of the same key are different shortcuts.
    expect(findShortcutBindingConflict(standard, "search_session", "Tap:Shift", "MacIntel")).toBe("voice_stop");
    expect(findShortcutBindingConflict(standard, "voice_stop", "DoubleTap:Shift", "MacIntel")).toBe("voice_start");
  });

  it("frees the keys of a shortcut that is turned off", () => {
    const newSessionOff = {
      enabled: true,
      preset: "standard" as const,
      typeToCompose: true,
      overrides: { new_session: null },
    };
    expect(findShortcutBindingConflict(newSessionOff, "next_attention", "Cmd+N", "MacIntel")).toBeNull();

    // A custom binding holds its keys, and the action's preset keys are then free.
    const movedNewSession = {
      enabled: true,
      preset: "standard" as const,
      typeToCompose: true,
      overrides: { new_session: "Alt+N" },
    };
    expect(findShortcutBindingConflict(movedNewSession, "next_attention", "Cmd+N", "MacIntel")).toBeNull();
    expect(findShortcutBindingConflict(movedNewSession, "next_attention", "Alt+N", "MacIntel")).toBe("new_session");
  });

  it("opens terminal from a thread and returns to the thread from terminal", () => {
    const openTerminal = vi.fn();
    const navigateTo = vi.fn();
    const navigateToSession = vi.fn();
    const navigateToMostRecentSession = vi.fn().mockReturnValue(true);
    const closeSecondaryPage = vi.fn();
    const setActiveTab = vi.fn();
    const toggleSidebar = vi.fn();

    const opened = performShortcutAction("open_terminal", {
      secondaryPage: null,
      currentSessionId: "s1",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [{ sessionId: "s1", createdAt: 1 }],
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal,
      toggleSidebar,
      setActiveTab,
      navigateTo,
      navigateToSession,
      navigateToMostRecentSession,
      closeSecondaryPage,
    });

    expect(opened).toBe(true);
    expect(openTerminal).toHaveBeenCalledWith("/repo", "s1");
    expect(navigateTo).toHaveBeenCalledWith("/terminal");

    const returned = performShortcutAction("open_terminal", {
      secondaryPage: "terminal",
      currentSessionId: "s1",
      currentSessionCwd: "/repo",
      terminalCwd: "/repo",
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [{ sessionId: "s1", createdAt: 1 }],
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal,
      toggleSidebar,
      setActiveTab,
      navigateTo,
      navigateToSession,
      navigateToMostRecentSession,
      closeSecondaryPage,
    });

    expect(returned).toBe(true);
    expect(closeSecondaryPage).toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith("chat");
  });

  it("wraps between active sessions", () => {
    const navigateToSession = vi.fn();

    const handled = performShortcutAction("next_session", {
      secondaryPage: null,
      currentSessionId: "s2",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [
        { sessionId: "s1", createdAt: 3, orderIndex: 0 },
        { sessionId: "s2", createdAt: 2, orderIndex: 1 },
        { sessionId: "s3", createdAt: 1, archived: true },
      ],
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(navigateToSession).toHaveBeenCalledWith("s1");
  });

  it("follows sidebar order instead of createdAt order for previous and next session shortcuts", () => {
    const navigateToSession = vi.fn();
    const sessions = [
      { sessionId: "s-created-latest", createdAt: 300, orderIndex: 2 },
      { sessionId: "s-current", createdAt: 200, orderIndex: 0 },
      { sessionId: "s-middle", createdAt: 100, orderIndex: 1 },
    ];

    performShortcutAction("next_session", {
      secondaryPage: null,
      currentSessionId: "s-current",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions,
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(navigateToSession).toHaveBeenCalledWith("s-middle");
  });

  it("skips reviewer sessions when following sidebar order", () => {
    const navigateToSession = vi.fn();
    const sessions = [
      { sessionId: "leader", createdAt: 300, orderIndex: 0 },
      { sessionId: "reviewer-chip", createdAt: 250, orderIndex: null },
      { sessionId: "worker", createdAt: 200, orderIndex: 1 },
    ];

    performShortcutAction("next_session", {
      secondaryPage: null,
      currentSessionId: "leader",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions,
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(navigateToSession).toHaveBeenCalledWith("worker");
    expect(navigateToSession).not.toHaveBeenCalledWith("reviewer-chip");
  });

  it("wraps next_session from the last visible non-reviewer to the first visible non-reviewer", () => {
    const navigateToSession = vi.fn();
    const sessions = [
      { sessionId: "leader", createdAt: 300, orderIndex: 0 },
      { sessionId: "reviewer-chip", createdAt: 250, orderIndex: null },
      { sessionId: "worker", createdAt: 200, orderIndex: 1 },
    ];

    performShortcutAction("next_session", {
      secondaryPage: null,
      currentSessionId: "worker",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions,
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(navigateToSession).toHaveBeenCalledWith("leader");
    expect(navigateToSession).not.toHaveBeenCalledWith("reviewer-chip");
  });

  it("wraps previous_session from the first visible non-reviewer to the last visible non-reviewer", () => {
    const navigateToSession = vi.fn();
    const sessions = [
      { sessionId: "leader", createdAt: 300, orderIndex: 0 },
      { sessionId: "reviewer-chip", createdAt: 250, orderIndex: null },
      { sessionId: "worker", createdAt: 200, orderIndex: 1 },
    ];

    performShortcutAction("previous_session", {
      secondaryPage: null,
      currentSessionId: "leader",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions,
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(navigateToSession).toHaveBeenCalledWith("worker");
    expect(navigateToSession).not.toHaveBeenCalledWith("reviewer-chip");
  });

  it("matches the standard preset shifted bracket session navigation bindings", () => {
    const previousAction = getMatchingShortcutAction(
      { enabled: true, preset: "standard", typeToCompose: true, overrides: {} },
      { key: "{", code: "BracketLeft", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
    );
    const nextAction = getMatchingShortcutAction(
      { enabled: true, preset: "standard", typeToCompose: true, overrides: {} },
      { key: "}", code: "BracketRight", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
    );

    expect(previousAction).toBe("previous_session");
    expect(nextAction).toBe("next_session");
  });

  it("runs the sidebar toggle action", () => {
    const toggleSidebar = vi.fn();

    const sidebarHandled = performShortcutAction("toggle_sidebar", {
      secondaryPage: null,
      currentSessionId: "s1",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [{ sessionId: "s1", createdAt: 1 }],
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar,
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession: vi.fn(),
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    });

    expect(sidebarHandled).toBe(true);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("opens universal search without requiring a current session", () => {
    const openSearch = vi.fn();
    const navigateToSession = vi.fn();

    const handled = performShortcutAction("search_session", {
      secondaryPage: "questmaster",
      currentSessionId: null,
      currentSessionCwd: null,
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [],
      openSearch,
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession,
      navigateToMostRecentSession: vi.fn().mockReturnValue(false),
      closeSecondaryPage: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(navigateToSession).not.toHaveBeenCalled();
  });

  it("steps the session's or the global attention list through the runtime", () => {
    // "Next Item in This Session" steps the chip of the session on screen and
    // "Next Item Across Sessions" the top bar's list. Without a handler, or with
    // no session on screen for the in-session one, they are left to the browser.
    const runtime = {
      secondaryPage: null,
      currentSessionId: "s1",
      currentSessionCwd: "/repo",
      terminalCwd: null,
      activeTab: "chat",
      isSearchOpen: false,
      sessions: [],
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      lastNewSessionContext: null,
      openNewSessionModal: vi.fn(),
      openTerminal: vi.fn(),
      toggleSidebar: vi.fn(),
      setActiveTab: vi.fn(),
      navigateTo: vi.fn(),
      navigateToSession: vi.fn(),
      navigateToMostRecentSession: vi.fn().mockReturnValue(true),
      closeSecondaryPage: vi.fn(),
    } satisfies ShortcutRuntime;
    const goToNextAttentionInSession = vi.fn();
    const goToNextAttentionGlobal = vi.fn();
    const wired = { ...runtime, goToNextAttentionInSession, goToNextAttentionGlobal };

    expect(performShortcutAction("next_attention", wired)).toBe(true);
    expect(goToNextAttentionInSession).toHaveBeenCalledWith("s1");
    expect(goToNextAttentionGlobal).not.toHaveBeenCalled();

    expect(performShortcutAction("next_attention_global", wired)).toBe(true);
    expect(goToNextAttentionGlobal).toHaveBeenCalledTimes(1);
    expect(goToNextAttentionInSession).toHaveBeenCalledTimes(1);

    expect(performShortcutAction("next_attention", { ...wired, currentSessionId: null })).toBe(false);
    expect(performShortcutAction("next_attention", runtime)).toBe(false);
    expect(performShortcutAction("next_attention_global", runtime)).toBe(false);
  });

  it("gives the two attention steps different preset keys", () => {
    // Every preset binds both, and never to the same keys.
    for (const preset of ["standard", "vscode-light", "vim-light"] as const) {
      const settings = { enabled: true, preset, typeToCompose: true, overrides: {} };
      const inSession = getEffectiveShortcutBinding(settings, "next_attention");
      const global = getEffectiveShortcutBinding(settings, "next_attention_global");
      expect(inSession).toBeTruthy();
      expect(global).toBeTruthy();
      expect(findShortcutBindingConflict(settings, "next_attention_global", global!, "MacIntel")).toBeNull();
      expect(findShortcutBindingConflict(settings, "next_attention", inSession!, "Linux x86_64")).toBeNull();
    }
  });

  it("marks only non-search app-wide actions as app-global shortcuts", () => {
    expect(isAppGlobalShortcutAction("open_terminal")).toBe(true);
    expect(isAppGlobalShortcutAction("previous_session")).toBe(true);
    expect(isAppGlobalShortcutAction("next_session")).toBe(true);
    expect(isAppGlobalShortcutAction("next_attention")).toBe(true);
    expect(isAppGlobalShortcutAction("next_attention_global")).toBe(true);
    expect(isAppGlobalShortcutAction("search_session")).toBe(false);
    expect(isAppGlobalShortcutAction("toggle_sidebar")).toBe(false);
  });

  it("prefers the current session cwd when opening a new session", () => {
    expect(
      resolveShortcutNewSessionContext("/repo/current", {
        cwd: "/repo/old",
        treeGroupId: "frontend",
        newSessionDefaultsKey: "tree-group:frontend",
      }),
    ).toEqual({
      cwd: "/repo/current",
      treeGroupId: "frontend",
      newSessionDefaultsKey: "tree-group:frontend",
    });
  });

  // A folder path only means something on its machine, so the new-session
  // dialog gets the machine from the same place as the folder: the current
  // session's host with its folder, or the last creation's host with that folder.
  it("keeps the folder's machine with the folder", () => {
    const last = { cwd: "/home/coder/app", hostId: "devbox-host", treeGroupId: "frontend" };
    expect(resolveShortcutNewSessionContext("/Users/me/app", last, "laptop-host")).toEqual({
      cwd: "/Users/me/app",
      hostId: "laptop-host",
      treeGroupId: "frontend",
    });
    // A current session on the server's machine does not take the last creation's host.
    expect(resolveShortcutNewSessionContext("/srv/app", last, null)).toEqual({
      cwd: "/srv/app",
      treeGroupId: "frontend",
    });
    expect(resolveShortcutNewSessionContext(null, last, null)).toEqual(last);
  });

  it("only blurs editable targets on Escape in vim mode", () => {
    const input = document.createElement("input");
    expect(
      shouldBlurVimEscape(
        { enabled: true, preset: "vim-light", typeToCompose: true, overrides: {} },
        { key: "Escape" },
        input,
      ),
    ).toBe(true);
    expect(
      shouldBlurVimEscape(
        { enabled: true, preset: "standard", typeToCompose: true, overrides: {} },
        { key: "Escape" },
        input,
      ),
    ).toBe(false);
  });
});
