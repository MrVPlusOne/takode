// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { removeSessionState } from "./store-session-cleanup.js";
import { useStore } from "./store.js";

describe("Codex subagent inspector local panel arbitration", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("closes the task panel when the inspector opens and closes the inspector when tasks open", () => {
    useStore.setState({ taskPanelOpen: true });
    useStore.getState().openCodexSubagentInspector("s1", { scopeTurnId: "turn-1" });
    expect(useStore.getState().taskPanelOpen).toBe(false);
    expect(useStore.getState().codexSubagentInspector).toEqual({ sessionId: "s1", scopeTurnId: "turn-1" });

    useStore.getState().setTaskPanelOpen(true);
    expect(useStore.getState().taskPanelOpen).toBe(true);
    expect(useStore.getState().codexSubagentInspector).toBeNull();
  });

  it("clears a stale inspector on session navigation and session removal", () => {
    useStore.getState().openCodexSubagentInspector("s1");
    useStore.getState().setCurrentSession("s2");
    expect(useStore.getState().codexSubagentInspector).toBeNull();

    useStore.getState().openCodexSubagentInspector("s1");
    const removed = removeSessionState(useStore.getState(), "s1");
    expect(removed.codexSubagentInspector).toBeNull();
  });
});
