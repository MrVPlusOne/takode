// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotifyMeControl, NotifyMeControlView } from "./NotifyMe.js";
import { useStore } from "../store.js";
import { buildThreadMonitoringProjection } from "../../server/thread-monitoring-projection.js";
import {
  THREAD_MONITORING_PROJECTION,
  type ThreadMonitoringEntry,
  type MonitoredThreadResult,
} from "../../shared/thread-monitoring.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entry: ThreadMonitoringEntry = {
  sessionId: "leader",
  sessionNum: 12,
  sessionName: "Research",
  threadKey: "q-42",
  title: "Compare design options",
  trackedAt: 1,
  pending: { id: "2", messageId: "result", timestamp: 2, summary: "The comparison is ready." },
};

describe("Notify Me controls", () => {
  it("offers only the state-appropriate header action while preserving monitoring icons and tooltips", () => {
    const onToggle = vi.fn();
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <NotifyMeControlView enabled pending={false} onOpen={onToggle} onAcknowledge={onAcknowledge} />,
    );
    expect(screen.getByRole("img", { name: "Monitored task" })).toBeTruthy();
    // The header shortens its visible label while the feature name remains available on hover and to assistive tools.
    expect(screen.getByRole("button", { name: "Notify Me" }).textContent?.trim()).toBe("Notify");
    expect(screen.getByRole("button", { name: "Notify Me" }).title).toContain("Notify Me");
    expect(screen.queryByText("Acknowledge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<NotifyMeControlView enabled pending onOpen={onToggle} onAcknowledge={onAcknowledge} />);
    // Pending results expose one action, and clicking it must not open the menu.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Notify Me" })).toBeNull();
    const acknowledge = screen.getByRole("button", { name: "Acknowledge" });
    expect(acknowledge).not.toHaveAttribute("aria-pressed");
    fireEvent.click(acknowledge);
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Monitored task has a result waiting" })).toBeTruthy();
    rerender(<NotifyMeControlView enabled={false} pending={false} onOpen={() => {}} onAcknowledge={() => {}} />);
    expect(screen.getByRole("button", { name: "Notify Me" }).textContent?.trim()).toBe("Notify");
    expect(screen.getByRole("button", { name: "Notify Me" }).title).toContain("Notify Me");
    expect(screen.getByRole("img", { name: "Notify Me" }).title).toContain("Notify Me");
  });

  it("keeps a newer result pending across an older acknowledgement and restores tracking only from server state", async () => {
    // Produce each update through the actual server projection so the browser never invents monitoring authority.
    function publish(revision: number, pending: MonitoredThreadResult | null) {
      useStore.getState().applySyncedProjectionSnapshot({
        projection: THREAD_MONITORING_PROJECTION,
        key: "leader",
        generation: "monitor-test",
        revision,
        value: buildThreadMonitoringProjection({
          state: {
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-42"],
              closedThreadTombstones: [],
              updatedAt: 0,
            },
            threadMonitoring: {
              revision,
              alertVersion: 1,
              threads: { "q-42": { trackedAt: 1, afterHistoryIndex: 0, pending } },
            },
          },
        }),
      });
    }
    let finishOldAcknowledgement!: (response: { ok: boolean }) => void;
    const oldAcknowledgement = new Promise((resolve) => {
      finishOldAcknowledgement = resolve;
    });
    const fetch = vi.fn().mockReturnValueOnce(oldAcknowledgement).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    publish(1, entry.pending);
    render(<NotifyMeControl sessionId="leader" threadKey="q-42" />);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "acknowledge", resultId: "2" });
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Notify Me" })).toBeNull();

    // A newer result arrives while the first request is still in flight. Its button must survive that response.
    act(() => publish(2, { ...entry.pending!, id: "3", messageId: "new-result" }));
    await act(async () => finishOldAcknowledgement({ ok: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Notify Me" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "acknowledge", resultId: "3" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled());

    // Once acknowledged, the button opens the Notify Me menu, where tracking can be turned off.
    act(() => publish(3, null));
    const notify = await screen.findByRole("button", { name: "Notify Me" });
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(notify.textContent?.trim()).toBe("Notify");
    fireEvent.click(notify);
    expect(notify).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Stop notifying" }));
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ action: "untrack" });
  });

  it("offers Main only the delayed choice, and nothing for the All view", () => {
    // Notify Me does not track Main, so its menu has no "Notify me now".
    const { container } = render(
      <>
        <NotifyMeControl sessionId="leader" threadKey="main" />
        <NotifyMeControl sessionId="leader" threadKey="all" />
      </>,
    );
    expect(screen.getAllByRole("button", { name: "Notify Me" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    expect(screen.queryByTestId("notify-me-now")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 hour" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-testid=notify-me-control]")).toHaveLength(1);
  });

  it("sets a reminder that marks the thread read, and shows its time on the button", async () => {
    // Choosing a delay saves the reminder, then clears the thread's unread results.
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    useStore.getState().setSessionNotifications("leader", [
      {
        id: "n-1",
        category: "review",
        summary: "Result",
        timestamp: 1,
        messageId: null,
        done: false,
        threadKey: "q-42",
        questId: "q-42",
      },
    ]);
    render(<NotifyMeControl sessionId="leader" threadKey="q-42" />);
    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    fireEvent.click(screen.getByRole("button", { name: "6 hours" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][0]).toBe("/api/sessions/leader/thread-reminders");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ threadKey: "q-42", durationMs: 6 * 60 * 60 * 1000 });
    expect(fetch.mock.calls[1][0]).toContain("/notifications/n-1/done");
    await waitFor(() => expect(screen.queryByTestId("notify-me-menu")).not.toBeInTheDocument());
  });

  it("shows a reminder's time on one line, and on a phone's strip only its day", () => {
    // Jiayi (Oct 31): on a thread's strip the icon button was 24 px wide, so "Sun 10:17 PM"
    // wrapped onto three lines, taller than the strip. The button widens instead, the time never
    // wraps, and the compact (strip) form drops a later day's time on phones.
    const inTwoDays = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const view = (iconOnly: boolean, reminderAt: number) =>
      render(
        <NotifyMeControlView
          enabled={false}
          pending={false}
          reminderAt={reminderAt}
          iconOnly={iconOnly}
          onOpen={() => {}}
          onAcknowledge={() => {}}
        />,
      );
    const strip = view(true, inTwoDays);
    const time = screen.getByTestId("notify-me-reminder-time");
    expect(time).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("button", { name: "Notify Me" })).toHaveClass("whitespace-nowrap");
    const clock = new Date(inTwoDays).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(time.textContent).toContain(clock);
    expect([...time.querySelectorAll("span")].find((part) => part.textContent?.includes(clock))).toHaveClass(
      "max-sm:hidden",
    );
    strip.unmount();
    // Elsewhere the whole time always shows.
    view(false, inTwoDays);
    expect(screen.getByTestId("notify-me-reminder-time").querySelector(".max-sm\\:hidden")).toBeNull();
    cleanup();
    // Today's reminder (noon today, whatever the hour the test runs) is only a time, which fits anywhere.
    view(true, new Date().setHours(12, 0, 0, 0));
    expect(screen.getByTestId("notify-me-reminder-time").querySelector("span")).toBeNull();
  });
});
