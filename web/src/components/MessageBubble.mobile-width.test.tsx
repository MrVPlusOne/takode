// @vitest-environment jsdom

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
    countUserPermissions: () => 0,
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

describe("MessageBubble mobile width", () => {
  it("lets mobile user bubbles use the width left after the menu button", () => {
    // Regression coverage for narrow mobile feeds: the bubble should not stay
    // capped at 85% on phones, but it still reserves room for the visible menu.
    const msg = makeMessage({ role: "user", content: "Use more of the mobile line width" });
    render(<MessageBubble message={msg} />);

    const className = screen.getByTestId("user-message-bubble").className;
    expect(className).toContain("max-w-[calc(100%_-_2rem)]");
    expect(className).toContain("sm:max-w-[80%]");
  });
});
