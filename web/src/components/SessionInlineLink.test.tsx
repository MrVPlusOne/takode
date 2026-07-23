// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";

const mockFetchMessagePreview = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    fetchMessagePreview: (...args: unknown[]) => mockFetchMessagePreview(...args),
  },
}));

import { SessionInlineLink } from "./SessionInlineLink.js";

describe("SessionInlineLink", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockFetchMessagePreview.mockReset();
    window.history.replaceState({}, "", "/#/questmaster");
  });

  it("can target a leader quest thread while keeping readable session refs", () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "leader-abc",
        sessionNum: 7,
        state: "connected",
        cwd: "/repo",
        createdAt: 1,
        isOrchestrator: true,
      } as any,
    ]);

    render(
      <SessionInlineLink sessionId="leader-abc" threadKey="q-42">
        #7
      </SessionInlineLink>,
    );

    const link = screen.getByRole("link", { name: "#7" });
    expect(link).toHaveAttribute("href", "#/session/7?thread=q-42");

    fireEvent.click(link);

    expect(window.location.hash).toBe("#/session/7?thread=q-42");
  });

  it("keeps context-free links plain", () => {
    render(<SessionInlineLink sessionId="plain-session">plain</SessionInlineLink>);

    const link = screen.getByRole("link", { name: "plain" });
    expect(link).toHaveAttribute("href", "#/session/plain-session");
  });

  it("resolves message links to stable message id and source thread navigation", async () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "leader-abc",
        sessionNum: 7,
        state: "connected",
        cwd: "/repo",
        createdAt: 1,
        isOrchestrator: true,
      } as any,
    ]);
    mockFetchMessagePreview.mockResolvedValue({
      id: "stable-msg-3430",
      role: "assistant",
      content: "preview",
      timestamp: 1,
      metadata: { threadKey: "q-1622" },
    });

    render(
      <SessionInlineLink sessionId="leader-abc" messageIndex={3430}>
        #7 msg 3430
      </SessionInlineLink>,
    );

    const link = screen.getByRole("link", { name: "#7 msg 3430" });
    expect(link).toHaveAttribute("href", "#/session/7?msg=3430");

    fireEvent.click(link);

    await waitFor(() => {
      expect(mockFetchMessagePreview).toHaveBeenCalledWith("leader-abc", 3430);
      expect(window.location.hash).toBe("#/session/7/msg/stable-msg-3430?thread=q-1622");
    });
    expect(useStore.getState().scrollToMessageId.get("leader-abc")).toBe("stable-msg-3430");
  });

  it("falls back to legacy message-index navigation when message resolution fails", async () => {
    mockFetchMessagePreview.mockResolvedValue(null);

    render(
      <SessionInlineLink sessionId="plain-session" messageIndex={42}>
        plain msg
      </SessionInlineLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "plain msg" }));

    await waitFor(() => {
      expect(mockFetchMessagePreview).toHaveBeenCalledWith("plain-session", 42);
      expect(useStore.getState().pendingScrollToMessageIndex.get("plain-session")).toBe(42);
    });
  });
});
