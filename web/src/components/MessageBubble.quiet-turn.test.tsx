// @vitest-environment jsdom
// Rendering of a worker message that ended with the quiet marker.

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ChatMessage } from "../types.js";

vi.mock("react-markdown", () => ({
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: { p?: (props: { children: string }) => ReactNode };
  }) => {
    if (components?.p) {
      return <div data-testid="markdown">{components.p({ children })}</div>;
    }
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

vi.mock("../store.js", () => {
  const useStore: any = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      messages: new Map(),
      sessions: new Map(),
      sdkSessions: [],
      sessionSearch: new Map(),
    });
  useStore.getState = () => ({
    messages: new Map(),
    sdkSessions: [],
  });
  return {
    useStore,
    getSessionSearchState: () => ({
      query: "",
      isOpen: false,
      mode: "strict",
      category: "all",
      matches: [],
      currentMatchIndex: -1,
    }),
  };
});

import { MessageBubble } from "./MessageBubble.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageBubble quiet worker turn", () => {
  it("shows a quiet note instead of the raw quiet marker line", () => {
    // Workers end quiet turns with a marker line; the feed shows its summary, never the syntax.
    const text = "No reply yet.\n\n{[(Quiet: 1 PM check: no reply yet)]}";
    render(
      <MessageBubble
        message={makeMessage({ role: "assistant", content: text, contentBlocks: [{ type: "text", text }] })}
      />,
    );

    expect(screen.getByTestId("quiet-turn-note").textContent).toBe("quiet1 PM check: no reply yet");
    expect(document.body.textContent).not.toContain("{[(Quiet:");
    expect(document.body.textContent).toContain("No reply yet.");
  });
});
