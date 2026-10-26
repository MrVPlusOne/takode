// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";

const mockGetSessionNotifications = vi.fn(async (_sessionId: string, _options?: unknown): Promise<any[]> => []);
vi.mock("../api.js", () => ({
  api: {
    getSessionNotifications: (sessionId: string, options?: unknown) => mockGetSessionNotifications(sessionId, options),
  },
}));

import { useStore } from "../store.js";
import { useGlobalNeedsInputEntries } from "./useGlobalNeedsInputEntries.js";

beforeEach(() => {
  mockGetSessionNotifications.mockReset();
  mockGetSessionNotifications.mockResolvedValue([]);
  useStore.setState({ sessionNotifications: new Map(), sdkSessions: [] });
});

describe("useGlobalNeedsInputEntries", () => {
  it("loads a leader with unread answers, asking only for what the user can still see", async () => {
    // Asking for the full list brought back old results the counts had long hidden (in closed
    // tabs, or covered by an earlier read): 21 on one leader that would never clear.
    useStore.setState({
      sdkSessions: [
        { sessionId: "leader", createdAt: 1, isOrchestrator: true, activeReviewNotificationCount: 2 } as any,
      ],
    });
    renderHook(() => useGlobalNeedsInputEntries());
    await waitFor(() => expect(mockGetSessionNotifications).toHaveBeenCalledWith("leader", { visible: true }));
  });

  // Session summaries only carry counts; the hook loads the prompts themselves so
  // the attention list can show them without the session being open.
  it("loads notification details for sessions whose snapshot says needs-input is active", async () => {
    const liveNotifications = [
      { id: "n-1", category: "needs-input", summary: "Confirm scope", timestamp: Date.now(), messageId: "m1" },
    ];
    mockGetSessionNotifications.mockResolvedValueOnce(liveNotifications);
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "s-load",
          createdAt: 1,
          notificationUrgency: "needs-input",
          activeNotificationCount: 1,
          notificationStatusVersion: 2,
        } as any,
      ],
    });

    const { result } = renderHook(() => useGlobalNeedsInputEntries());

    await waitFor(() => expect(result.current.entries.map((entry) => entry.notification.id)).toEqual(["n-1"]));
    expect(mockGetSessionNotifications).toHaveBeenCalledWith("s-load", { visible: true });
    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      activeNeedsInputNotificationCount: 1,
      activeReviewNotificationCount: 0,
      notificationStatusVersion: 2,
    });
  });

  // A lazy fetch can be requested while the summary is active and resolve after
  // the session already broadcast a newer clear. The response must respect that
  // freshness instead of reviving already-answered prompts.
  it("does not let a late fetch revive notifications after a newer cleared summary", async () => {
    let resolveNotifications!: (notifications: any[]) => void;
    const request = new Promise<any[]>((resolve) => {
      resolveNotifications = resolve;
    });
    mockGetSessionNotifications.mockReturnValueOnce(request);
    const session = { sessionId: "s-late", createdAt: 1 };
    useStore.setState({
      sdkSessions: [
        {
          ...session,
          notificationUrgency: "needs-input",
          activeNotificationCount: 1,
          activeNeedsInputNotificationCount: 1,
          notificationStatusVersion: 2,
          notificationStatusUpdatedAt: 2000,
        } as any,
      ],
    });

    const { result } = renderHook(() => useGlobalNeedsInputEntries());
    await waitFor(() => expect(mockGetSessionNotifications).toHaveBeenCalledWith("s-late", { visible: true }));

    act(() => {
      useStore.setState({
        sdkSessions: [
          {
            ...session,
            notificationUrgency: null,
            activeNotificationCount: 0,
            activeNeedsInputNotificationCount: 0,
            notificationStatusVersion: 3,
            notificationStatusUpdatedAt: 3000,
          } as any,
        ],
      });
    });
    await act(async () => {
      resolveNotifications([
        { id: "n-stale", category: "needs-input", summary: "Already answered", timestamp: 1, messageId: "m1" },
      ]);
      await request;
    });

    expect(useStore.getState().sessionNotifications.get("s-late")).toBeUndefined();
    expect(result.current.entries).toEqual([]);
  });
});
