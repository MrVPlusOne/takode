// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import { MarkdownContent } from "./MarkdownContent.js";

describe("MarkdownContent quest-link surface", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.location.hash = "#/session/s1";
  });

  it("opts parsed and plain quest links into the hybrid only inside an explicit chat-feed surface", () => {
    render(<MarkdownContent text="[Exact](quest:q-42:feedback:3) and plain q-43" questLinkSurface="chat-feed" />);

    expect(screen.getAllByRole("button", { name: /Preview q-/ })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Exact" })).toHaveAttribute("href", "#/session/s1?quest=q-42&feedback=3");
    expect(screen.getByRole("link", { name: "q-43" })).toHaveAttribute("href", "#/session/s1?quest=q-43");
  });

  it("keeps the shared default and explicit legacy override free of feed-only Preview controls", () => {
    render(
      <>
        <MarkdownContent text="[Default](quest:q-44)" />
        <MarkdownContent text="[Explicit legacy](quest:q-45)" questLinkSurface="legacy" />
      </>,
    );

    expect(screen.queryByRole("button", { name: /Preview q-/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Default" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explicit legacy" })).toBeInTheDocument();
  });

  it("closes a covering view when a quest link's thread icon goes to the thread", () => {
    // Guided reviews and the file viewer pass onSessionNavigate to close themselves; the quest
    // thread icon is a session navigation like a session link, so it must close them too.
    useStore.setState({
      sessionBoards: new Map([["leader-46", [{ questId: "q-46", status: "WORKING", updatedAt: 1, createdAt: 1 }]]]),
    });
    const onSessionNavigate = vi.fn();
    render(<MarkdownContent text="See q-46" questLinkSurface="chat-feed" onSessionNavigate={onSessionNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Open the q-46 thread" }));

    expect(window.location.hash).toBe("#/session/leader-46?thread=q-46");
    expect(onSessionNavigate).toHaveBeenCalledTimes(1);
  });
});
