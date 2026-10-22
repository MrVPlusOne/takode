// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSetMessageExpanded = vi.hoisted(() => vi.fn());
vi.mock("../api/message-expansion.js", () => ({ setMessageExpanded: mockSetMessageExpanded }));

import { useStore } from "../store.js";
import { ReportCard } from "./ReportCard.js";

// jsdom has no layout, so the report's measured height is stubbed per test.
function stubScrollHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(height);
}

afterEach(() => vi.restoreAllMocks());

describe("ReportCard", () => {
  it("clips a long report and toggles between full and clipped in place", () => {
    stubScrollHeight(2000);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <ReportCard>
        <p>Daily briefing</p>
      </ReportCard>,
    );

    const clip = screen.getByText("Daily briefing").parentElement!.parentElement!;
    const toggle = screen.getByRole("button", { name: "Show full report" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(clip.style.maxHeight).toBe("320px");

    fireEvent.click(toggle);
    const showLess = screen.getByRole("button", { name: "Show less" });
    expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(clip.style.maxHeight).toBe("");
    // An expanded report can run many screens, so its only collapse control sits
    // in a bar pinned to the feed's top, ahead of the report, not at its far end.
    expect(showLess.parentElement).toHaveClass("sticky");
    expect(showLess.compareDocumentPosition(clip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show full report" })).not.toBeInTheDocument();

    // Collapsing returns to the clipped preview and brings the card back on screen.
    fireEvent.click(showLess);
    expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show less" })).not.toBeInTheDocument();
    expect(clip.style.maxHeight).toBe("320px");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    vi.unstubAllGlobals();
  });

  it("shows a short report whole without a toggle", () => {
    stubScrollHeight(200);
    render(
      <ReportCard>
        <p>Short note</p>
      </ReportCard>,
    );

    expect(screen.getByText("Short note")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-card")).toBeInTheDocument();
  });

  describe("expansion kept by the session", () => {
    // A report in a session's feed is expanded or collapsed for every browser of that session:
    // the toggle asks the server, and the card follows the state the server sends back.
    function setExpandedOnServer(expandedMessages: Record<string, number>) {
      act(() => useStore.getState().updateSession("leader", { expandedMessages } as never));
    }

    function renderSessionReport() {
      useStore.getState().reset();
      useStore.setState({ sessions: new Map([["leader", { session_id: "leader" } as never]]) });
      stubScrollHeight(2000);
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      Element.prototype.scrollIntoView = vi.fn();
      return render(
        <ReportCard sessionId="leader" messageId="report-1">
          <p>Daily briefing</p>
        </ReportCard>,
      );
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      mockSetMessageExpanded.mockReset();
    });

    it("expands and collapses through the server", () => {
      mockSetMessageExpanded.mockResolvedValue({ ok: true });
      renderSessionReport();

      fireEvent.click(screen.getByRole("button", { name: "Show full report" }));
      expect(mockSetMessageExpanded).toHaveBeenCalledWith("leader", "report-1", true);
      expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();

      setExpandedOnServer({ "report-1": 1 });
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(mockSetMessageExpanded).toHaveBeenLastCalledWith("leader", "report-1", false);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

      // The collapse this browser asked for brings the clipped card back on screen once it arrives.
      setExpandedOnServer({});
      expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });

    it("shows a report another browser expanded, without moving this one's view when it collapses there", () => {
      renderSessionReport();
      setExpandedOnServer({ "report-1": 1 });
      expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
      setExpandedOnServer({});
      expect(screen.getByRole("button", { name: "Show full report" })).toBeInTheDocument();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("still expands here when the server cannot be reached", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockSetMessageExpanded.mockRejectedValue(new Error("offline"));
      renderSessionReport();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Show full report" }));
      });
      expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    });
  });
});
