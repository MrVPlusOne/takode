// @vitest-environment jsdom

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIEWPORT_HANDOFF_VERSION } from "../../shared/viewport-handoff.js";
import { resetViewportHandoffClientForTest } from "../utils/viewport-handoff-client.js";
import { ViewportHandoffSessionEntryGate, ViewportHandoffThreadEntryGate } from "./ViewportHandoffEntryGate.js";

function emptyState(revision = 0) {
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    sessionId: "session-1",
    revision,
    updatedAt: revision === 0 ? 0 : 5_000 + revision,
    selectedThreadKey: "main",
    selectedThreadRevision: revision,
    selectedThreadActivityAt: revision === 0 ? 0 : 5_000 + revision,
    selectedThreadUpdatedAt: revision === 0 ? 0 : 5_000 + revision,
    handoffs: {},
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  resetViewportHandoffClientForTest();
});

describe("viewport handoff entry gates", () => {
  it("holds initial session content until one coalesced backend read settles", async () => {
    let resolveRead: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRead = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <ViewportHandoffSessionEntryGate sessionId="session-1" entryId="cold-session" fallback={<p>Loading</p>}>
          <p>Conversation</p>
        </ViewportHandoffSessionEntryGate>
      </StrictMode>,
    );

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByText("Conversation")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    resolveRead!(jsonResponse({ state: emptyState(), serverNow: 5_000 }));
    await waitFor(() => expect(screen.getByText("Conversation")).toBeTruthy());
  });

  it("falls through safely when a thread read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(
      <ViewportHandoffThreadEntryGate
        sessionId="session-1"
        threadKey="main"
        entryId="thread-entry"
        fallback={<p>Loading thread</p>}
      >
        <p>Local fallback feed</p>
      </ViewportHandoffThreadEntryGate>,
    );

    expect(screen.getByText("Loading thread")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Local fallback feed")).toBeTruthy());
  });

  it("reuses an explicit entry read after a non-navigation unmount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: emptyState(), serverNow: 5_000 }));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ViewportHandoffSessionEntryGate sessionId="session-1" entryId="stable-chat-entry">
        <p>Conversation</p>
      </ViewportHandoffSessionEntryGate>,
    );
    await waitFor(() => expect(screen.getByText("Conversation")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(<p>Diff or plan overlay</p>);
    expect(screen.getByText("Diff or plan overlay")).toBeTruthy();

    view.rerender(
      <ViewportHandoffSessionEntryGate sessionId="session-1" entryId="stable-chat-entry">
        <p>Conversation</p>
      </ViewportHandoffSessionEntryGate>,
    );
    await waitFor(() => expect(screen.getByText("Conversation")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("performs a fresh read when a persistent gate returns from A to B to A", async () => {
    const fetchMock = vi.fn((url: string) => {
      const sessionId = url.includes("session-2") ? "session-2" : "session-1";
      return Promise.resolve(
        jsonResponse({
          state: { ...emptyState(), sessionId },
          serverNow: 5_000,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ViewportHandoffSessionEntryGate sessionId="session-1">
        <p>Ready</p>
      </ViewportHandoffSessionEntryGate>,
    );
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());

    view.rerender(
      <ViewportHandoffSessionEntryGate sessionId="session-2">
        <p>Ready</p>
      </ViewportHandoffSessionEntryGate>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    view.rerender(
      <ViewportHandoffSessionEntryGate sessionId="session-1">
        <p>Ready</p>
      </ViewportHandoffSessionEntryGate>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("loads the full session and selected thread independently", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ state: emptyState(2), serverNow: 5_000 }))
      .mockResolvedValueOnce(jsonResponse({ state: emptyState(2), threadKey: "main", record: null, serverNow: 5_010 }));
    vi.stubGlobal("fetch", fetchMock);

    function NestedGates() {
      return (
        <ViewportHandoffSessionEntryGate sessionId="session-1" entryId="session-entry">
          <ViewportHandoffThreadEntryGate sessionId="session-1" threadKey="main" entryId="thread-entry">
            <p>Ready</p>
          </ViewportHandoffThreadEntryGate>
        </ViewportHandoffSessionEntryGate>
      );
    }

    render(<NestedGates />);
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/sessions/session-1/viewport-handoff",
      "/api/sessions/session-1/viewport-handoff?threadKey=main",
    ]);
  });
});
