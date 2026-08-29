// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";
import { useStore } from "../store.js";
import { MessageLinkHoverCard } from "./MessageLinkHoverCard.js";
import { QuestHoverCard } from "./QuestHoverCard.js";

function quest(): QuestmasterTask {
  return {
    id: "q-70-v1",
    questId: "q-70",
    version: 1,
    title: "Legacy rich card",
    status: "refined",
    description: "Description",
    tldr: "Related [q-71](quest:q-71)",
    createdAt: 1,
  } as QuestmasterTask;
}

describe("quest preview surface boundary", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ zoomLevel: 1 });
  });

  it("keeps quest links inside a message-link hover card on the legacy non-feed surface", () => {
    const session = {
      id: "session-hover",
      sessionNum: 70,
      status: "idle",
      sdkState: "connected",
      backendType: "codex",
    } as SidebarSessionItem;

    render(
      <MessageLinkHoverCard
        session={session}
        anchorRect={DOMRect.fromRect({ x: 20, y: 20, width: 80, height: 20 })}
        messageIndex={4}
        prefetchedMessage={{
          id: "previewed-message",
          role: "assistant",
          content: "Nested [q-72](quest:q-72)",
          contentBlocks: [{ type: "text", text: "Nested [q-72](quest:q-72)" }],
          timestamp: 1,
        }}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const card = screen.getByTestId("message-link-hover-card");
    expect(within(card).getByRole("link", { name: "q-72" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Preview q-/ })).toBeNull();
  });

  it("keeps Markdown nested in the existing QuestHoverCard on the legacy surface", () => {
    render(
      <QuestHoverCard
        quest={quest()}
        anchorRect={DOMRect.fromRect({ x: 20, y: 20, width: 80, height: 20 })}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const card = screen.getByTestId("quest-hover-card");
    expect(within(card).getByRole("link", { name: "q-71" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Preview q-/ })).toBeNull();
  });
});
