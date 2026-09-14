// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotifyMeControl, NotifyMeControlView } from "./NotifyMe.js";
import { NotifyMeResults } from "./GlobalNotifyMeMenu.js";
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
  it("keeps opening a result separate from acknowledging or untracking it", () => {
    const open = vi.fn();
    const action = vi.fn();
    render(<NotifyMeResults entries={[entry]} onOpen={open} onAction={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare design options" }));
    expect(open).toHaveBeenCalledWith(entry);
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(action).toHaveBeenLastCalledWith(entry, "acknowledge");
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    expect(action).toHaveBeenLastCalledWith(entry, "untrack");
  });

  it("offers only the state-appropriate header action while preserving monitoring icons and tooltips", () => {
    const onToggle = vi.fn();
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <NotifyMeControlView enabled pending={false} onToggle={onToggle} onAcknowledge={onAcknowledge} />,
    );
    expect(screen.getByRole("img", { name: "Monitored task" })).toBeTruthy();
    // The header shortens its visible label while the feature name remains available on hover and to assistive tools.
    expect(screen.getByRole("button", { name: "Notify Me" }).textContent?.trim()).toBe("Notify");
    expect(screen.getByRole("button", { name: "Notify Me" }).title).toContain("Notify Me");
    expect(screen.queryByText("Acknowledge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notify Me" }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<NotifyMeControlView enabled pending onToggle={onToggle} onAcknowledge={onAcknowledge} />);
    // Pending results expose one action, and clicking it must not invoke the tracking toggle.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Notify Me" })).toBeNull();
    const acknowledge = screen.getByRole("button", { name: "Acknowledge" });
    expect(acknowledge).not.toHaveAttribute("aria-pressed");
    fireEvent.click(acknowledge);
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Monitored task has a result waiting" })).toBeTruthy();
    rerender(<NotifyMeControlView enabled={false} pending={false} onToggle={() => {}} onAcknowledge={() => {}} />);
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

    act(() => publish(3, null));
    const notify = await screen.findByRole("button", { name: "Notify Me" });
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(notify).toHaveAttribute("aria-pressed", "true");
    expect(notify.textContent?.trim()).toBe("Notify");
    fireEvent.click(notify);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ action: "untrack" });
    await waitFor(() => expect(notify).toBeEnabled());
  });

  it("offers no monitoring control for aggregate or Main views", () => {
    const { container } = render(
      <>
        <NotifyMeControl sessionId="leader" threadKey="main" />
        <NotifyMeControl sessionId="leader" threadKey="all" />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
