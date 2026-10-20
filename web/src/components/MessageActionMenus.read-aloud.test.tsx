// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import type { ReadAloudState } from "../read-aloud-player.js";

const player = vi.hoisted(() => ({
  state: null as ReadAloudState | null,
  startReadAloud: vi.fn(),
  stopReadAloud: vi.fn(),
}));
vi.mock("../read-aloud-player.js", () => ({
  startReadAloud: player.startReadAloud,
  stopReadAloud: player.stopReadAloud,
  useReadAloudState: (messageId: string) => (player.state?.messageId === messageId ? player.state : null),
}));

import { AssistantMessageMenu } from "./MessageActionMenus.js";

const message: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "## Done\n\nThe timer is fixed.",
  timestamp: 10,
  historyIndex: 5,
};

function renderMenu() {
  render(
    <AssistantMessageMenu
      message={message}
      contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
      sessionId="s1"
      showSideChatActions={false}
    />,
  );
}

describe("AssistantMessageMenu read aloud", () => {
  beforeEach(() => {
    useStore.getState().reset();
    player.state = null;
    player.startReadAloud.mockClear();
    player.stopReadAloud.mockClear();
  });

  it("reads the message's Markdown aloud from the menu", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));

    expect(player.startReadAloud).toHaveBeenCalledWith({
      sessionId: "s1",
      messageId: "assistant-1",
      text: "## Done\n\nThe timer is fixed.",
      historyIndex: 5,
    });
  });

  it("offers Stop while the message is being read", () => {
    player.state = { messageId: "assistant-1", sessionId: "s1", status: "ready" };
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop reading aloud" }));
    expect(player.stopReadAloud).toHaveBeenCalled();
  });

  it("shows a failure next to the button and dismisses it on tap", () => {
    player.state = {
      messageId: "assistant-1",
      sessionId: "s1",
      status: "error",
      error: "Read aloud failed. quota",
    };
    renderMenu();

    fireEvent.click(screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent("Read aloud failed. quota");
    expect(player.stopReadAloud).toHaveBeenCalled();
    // A failed read can be retried from the menu.
    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeVisible();
  });
});
