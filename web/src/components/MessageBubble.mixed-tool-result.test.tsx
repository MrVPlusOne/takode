// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types.js";
import { useStore } from "../store.js";
import { MessageBubble } from "./MessageBubble.js";

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return `/api/fs/image?${params.toString()}`;
    },
    getToolResult: vi.fn(),
    markNotificationDone: vi.fn(async () => ({})),
    revertToMessage: vi.fn(async () => ({})),
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
  },
}));

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

const SESSION_ID = "mixed-tool-session";

function makeMixedToolMessage(): ChatMessage {
  return {
    id: "mixed-tool-message",
    role: "assistant",
    content: "Searching the rendered routing evidence now.",
    contentBlocks: [
      { type: "text", text: "Searching the rendered routing evidence now." },
      {
        type: "tool_use",
        id: "tool-web-q1596",
        name: "WebSearch",
        input: { query: "recent thread fallback evidence" },
      },
    ],
    timestamp: 1_783_538_999_000,
    metadata: {
      threadKey: "q-1596",
      questId: "q-1596",
      threadRefs: [{ threadKey: "q-1596", questId: "q-1596", source: "inferred" }],
    },
  };
}

beforeEach(() => {
  useStore.getState().reset();
  useStore.setState({
    toolResults: new Map([
      [
        SESSION_ID,
        new Map([
          [
            "tool-web-q1596",
            {
              tool_use_id: "tool-web-q1596",
              content:
                "Recent Thread Fallback Evidence\nhttps://example.test/q1596\nThe mixed text plus non-Bash tool result is routed to q-1596.",
              is_error: false,
              total_size: 120,
              is_truncated: false,
            },
          ],
        ]),
      ],
    ]),
  });
});

afterEach(() => {
  useStore.getState().reset();
});

describe("MessageBubble mixed text and tool result rendering", () => {
  it("renders stored tool result previews for mixed text plus non-Bash tool blocks", () => {
    render(<MessageBubble message={makeMixedToolMessage()} sessionId={SESSION_ID} currentThreadKey="q-1596" />);

    expect(screen.getByText("Searching the rendered routing evidence now.")).toBeTruthy();
    expect(screen.getByText("Web Search")).toBeTruthy();
    fireEvent.click(screen.getByText("Web Search").closest('[role="button"]')!);
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.getByText(/Recent Thread Fallback Evidence/)).toBeTruthy();
  });
});
