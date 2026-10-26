// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageThreadHeader } from "./MessageThreadHeader.js";

/**
 * A message's "thread:…" link opens that thread at the message itself: Jiayi expected to land on
 * the message she tapped, not wherever the thread was left.
 */
afterEach(() => {
  window.location.hash = "";
});

describe("MessageThreadHeader", () => {
  it("opens the thread at the message", () => {
    const onSelectThread = vi.fn();
    render(
      <MessageThreadHeader threadKey="main" onSelectThread={onSelectThread} message={{ sessionId: "l1", id: "m-4" }} />,
    );
    fireEvent.click(screen.getByTestId("thread-source-badge"));
    expect(window.location.hash).toBe("#/session/l1/msg/m-4?thread=main");
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("opens the thread alone without a message to land on", () => {
    const onSelectThread = vi.fn();
    render(<MessageThreadHeader threadKey="q-3" onSelectThread={onSelectThread} />);
    fireEvent.click(screen.getByTestId("thread-source-badge"));
    expect(onSelectThread).toHaveBeenCalledWith("q-3");
  });
});
