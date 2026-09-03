// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { persistLeaderSelectedThreadKey } from "./thread-viewport.js";

const mockRequestSnapshot = vi.hoisted(() => vi.fn(async () => {}));
const mockNoteSelectionActivity = vi.hoisted(() => vi.fn());

vi.mock("./thread-viewport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./thread-viewport.js")>();
  return { ...actual, requestThreadViewportSnapshot: mockRequestSnapshot };
});

vi.mock("./viewport-handoff-client.js", () => ({
  noteViewportSelectionActivity: mockNoteSelectionActivity,
}));

import {
  requestViewportHandoffForRouteDeparture,
  resolveViewportRouteIdentity,
} from "./viewport-handoff-route-departure.js";

beforeEach(() => {
  mockRequestSnapshot.mockClear();
  mockNoteSelectionActivity.mockClear();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  useStore.setState({ sdkSessions: [{ sessionId: "leader-1", sessionNum: 41, isOrchestrator: true } as any] });
});

describe("viewport handoff route departure", () => {
  it("uses the persisted selected leader thread for a bare hash while explicit routes win", () => {
    persistLeaderSelectedThreadKey("leader-1", "q-2035");

    expect(resolveViewportRouteIdentity("#/session/leader-1")).toEqual({
      sessionId: "leader-1",
      threadKey: "q-2035",
    });
    expect(resolveViewportRouteIdentity("#/session/41?thread=all")).toEqual({
      sessionId: "leader-1",
      threadKey: "all",
    });
  });

  it("publishes the outgoing thread with the same-session destination selection", () => {
    requestViewportHandoffForRouteDeparture("#/session/leader-1?thread=main", "#/session/leader-1?thread=q-2035");

    expect(mockNoteSelectionActivity).toHaveBeenCalledWith("leader-1", "q-2035");
    expect(mockRequestSnapshot).toHaveBeenCalledWith("leader-1", {
      threadKey: "main",
      selectedThreadKey: "q-2035",
      publishHandoff: true,
      keepalive: true,
      reason: "thread-departure",
    });
  });

  it("does not publish when only a message target or unrelated query changes", () => {
    requestViewportHandoffForRouteDeparture(
      "#/session/leader-1/msg/message-a?thread=q-2035&quest=q-7",
      "#/session/leader-1/msg/message-b?thread=q-2035&quest=q-8",
    );

    expect(mockRequestSnapshot).not.toHaveBeenCalled();
    expect(mockNoteSelectionActivity).not.toHaveBeenCalled();
  });

  it("publishes the persisted bare-route thread when leaving the session", () => {
    persistLeaderSelectedThreadKey("leader-1", "q-2035");

    requestViewportHandoffForRouteDeparture("#/session/leader-1", "#/settings");

    expect(mockRequestSnapshot).toHaveBeenCalledWith("leader-1", {
      threadKey: "q-2035",
      selectedThreadKey: "q-2035",
      publishHandoff: true,
      keepalive: true,
      reason: "session-departure",
    });
  });
});
