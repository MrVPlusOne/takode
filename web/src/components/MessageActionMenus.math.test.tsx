// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { AssistantMessageMenu } from "./MessageActionMenus.js";

describe("AssistantMessageMenu math source copy", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("copies the byte-for-byte original Markdown delimiters", async () => {
    // Full-message Markdown copy is source-backed and must never serialize the
    // rendered KaTeX DOM or canonicalize backslash delimiters to dollars.
    const source = "Inline \\(s\\).\n\n\\[\n\\frac{s-1}{6}\n\\]";
    const message: ChatMessage = {
      id: "math-message",
      role: "assistant",
      content: source,
      timestamp: Date.now(),
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <AssistantMessageMenu
        message={message}
        contentRef={{ current: null } as RefObject<HTMLDivElement | null>}
        showSideChatActions={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message options" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
  });
});
