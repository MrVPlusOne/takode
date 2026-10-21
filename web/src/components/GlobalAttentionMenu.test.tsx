// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { buildThreadMonitoringProjection } from "../../server/thread-monitoring-projection.js";
import {
  THREAD_MONITORING_PROJECTION,
  type MonitoredThreadResult,
  type ThreadMonitoringEntry,
} from "../../shared/thread-monitoring.js";

vi.mock("../api.js", () => ({
  api: {
    getSessionNotifications: vi.fn().mockResolvedValue([]),
    getQuestTitles: vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }),
  },
}));

import { useStore } from "../store.js";
import { GlobalAttentionMenu } from "./GlobalAttentionMenu.js";
import { ATTENTION_OPEN_EVENT } from "../utils/routing.js";

const RESULT: MonitoredThreadResult = {
  id: "5",
  messageId: "m-result",
  timestamp: 50,
  summary: "Comparison ready",
};

function entry(threadKey: string, title: string, pending: MonitoredThreadResult | null): ThreadMonitoringEntry {
  return {
    sessionId: "leader",
    sessionName: "Leader",
    sessionNum: 7,
    threadKey,
    title,
    trackedAt: 10,
    pending,
  };
}

/** Publishes Notify Me state through the real server projection, as the server would. */
function publishTracked(threads: Record<string, MonitoredThreadResult | null>, generation = "attention-menu-test") {
  useStore.getState().applySyncedProjectionSnapshot({
    projection: THREAD_MONITORING_PROJECTION,
    key: "leader",
    generation,
    revision: 1,
    value: buildThreadMonitoringProjection({
      state: {
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: Object.keys(threads),
          closedThreadTombstones: [],
          updatedAt: 0,
        },
        threadMonitoring: {
          revision: 1,
          alertVersion: 1,
          threads: Object.fromEntries(
            Object.entries(threads).map(([key, pending]) => [key, { trackedAt: 10, afterHistoryIndex: 0, pending }]),
          ),
        },
      },
    }),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({
    sdkSessions: [
      {
        sessionId: "leader",
        state: "connected",
        cwd: "/repo",
        createdAt: 1,
        sessionNum: 7,
        name: "Leader",
      },
    ],
    sessionNotifications: new Map(),
    sessionAttention: new Map(),
  });
});

describe("GlobalAttentionMenu", () => {
  it("is hidden while nothing is waiting, muted or tracked", () => {
    render(<GlobalAttentionMenu />);
    expect(screen.queryByTestId("attention-list-button")).not.toBeInTheDocument();
  });

  // With only a muted prompt nothing needs the user, so the button is a quiet
  // bell without a count, and the prompt sits in the collapsed muted section.
  it("keeps muted prompts reachable through a quiet bell", () => {
    useStore.setState({
      sessionNotifications: new Map([
        [
          "leader",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Rename later?",
              timestamp: 5,
              messageId: "m1",
              done: false,
              muted: true,
            },
          ],
        ],
      ]),
    });
    render(<GlobalAttentionMenu />);

    const bell = screen.getByRole("button", {
      name: "Muted questions, tracked tasks and reminders",
    });
    expect(bell).toHaveTextContent("");
    fireEvent.click(bell);

    const list = screen.getByRole("dialog", {
      name: "Everything that needs attention",
    });
    expect(within(list).getByText("Nothing needs attention.")).toBeInTheDocument();
    expect(within(list).queryByText("Rename later?")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /Muted questions/ }));
    expect(within(list).getByRole("region", { name: "Muted questions" })).toHaveTextContent("Rename later?");
  });

  // "All tracked" from the removed Notify Me menu: threads with a result stay in the
  // Notify Me group only, and the tracked section lists the rest, across result pages.
  it("lists tracked threads without a result below the queue, without repeating ones that have a result", async () => {
    publishTracked({ "q-42": RESULT, "q-43": null });
    const fetch = vi.fn(async (url: string) => {
      const body = url.includes("filter=pending")
        ? {
            entries: [entry("q-42", "q-42 Compare designs", RESULT)],
            total: 1,
            nextOffset: null,
          }
        : url.includes("offset=0")
          ? {
              entries: [entry("q-42", "q-42 Compare designs", RESULT)],
              total: 2,
              nextOffset: 1,
            }
          : {
              entries: [entry("q-43", "q-43 Faster restarts", null)],
              total: 2,
              nextOffset: null,
            };
      return { ok: true, json: async () => body };
    });
    vi.stubGlobal("fetch", fetch);

    render(<GlobalAttentionMenu />);
    const pill = await screen.findByTestId("attention-list-button");
    expect(pill).toHaveTextContent("1");
    fireEvent.click(pill);

    const list = screen.getByRole("dialog", {
      name: "Everything that needs attention",
    });
    await waitFor(() =>
      expect(within(list).getByRole("region", { name: "Notify Me results" })).toHaveTextContent("Comparison ready"),
    );
    fireEvent.click(within(list).getByRole("button", { name: /Tracked, no result yet/ }));
    const tracked = within(list).getByRole("region", {
      name: "Tracked, no result yet",
    });
    await waitFor(() => expect(tracked).toHaveTextContent("Faster restarts"));
    expect(tracked).not.toHaveTextContent("Compare designs");
    expect(within(tracked).getAllByTestId("attention-item-row")).toHaveLength(1);
  });

  // Follow-up phone reminders link to the attention list. A tap that starts the app lands on the
  // link's hash; the list opens over the home view and the hash is cleared. Notifications have not
  // loaded yet at that point, and the list must stay open until they arrive.
  it("opens the list from a reminder link at startup and keeps it open while items load", () => {
    // No tracked threads (a new generation replaces what an earlier test published).
    publishTracked({}, "attention-link-test");
    window.history.replaceState(null, "", "#/attention");
    render(<GlobalAttentionMenu />);

    const list = screen.getByRole("dialog", {
      name: "Everything that needs attention",
    });
    expect(window.location.hash).toBe("#/");
    expect(within(list).getByText("Nothing needs attention.")).toBeInTheDocument();

    act(() =>
      useStore.setState({
        sessionNotifications: new Map([
          [
            "leader",
            [
              {
                id: "n-1",
                category: "needs-input",
                summary: "Ship it?",
                timestamp: 5,
                messageId: "m1",
                done: false,
                muted: true,
              },
            ],
          ],
        ]),
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Muted questions/,
      }),
    ).toBeInTheDocument();

    // Once everything is handled the list closes, as before.
    act(() => useStore.setState({ sessionNotifications: new Map() }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // A running app gets the reminder tap from the service worker as an event, so the
  // current view stays put.
  it("opens the list on the attention-open event", () => {
    render(<GlobalAttentionMenu />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(ATTENTION_OPEN_EVENT));
    });
    expect(screen.getByRole("dialog", { name: "Everything that needs attention" })).toBeInTheDocument();
  });
});
