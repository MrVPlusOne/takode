// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useStore } from "../store.js";

const mockMarkdownRenderCount = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    mockMarkdownRenderCount.count += 1;
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

vi.mock("remark-breaks", () => ({
  default: {},
}));

import { MarkdownContent } from "./MarkdownContent.js";

describe("MarkdownContent memoization", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockMarkdownRenderCount.count = 0;
  });

  it("does not rerender markdown for stable equivalent props", () => {
    // Feed scroll state can re-render parents frequently; unchanged markdown
    // content should keep the same rendered subtree instead of rebuilding.
    const { rerender } = render(
      <MarkdownContent
        text="Stable visible markdown"
        sessionId="s1"
        searchHighlight={{ query: "stable", mode: "strict", isCurrent: false }}
      />,
    );

    expect(mockMarkdownRenderCount.count).toBe(1);

    rerender(
      <MarkdownContent
        text="Stable visible markdown"
        sessionId="s1"
        searchHighlight={{ query: "stable", mode: "strict", isCurrent: false }}
      />,
    );

    expect(mockMarkdownRenderCount.count).toBe(1);
  });
  it("rerenders only when the explicit quest-link surface changes", () => {
    const { rerender } = render(
      <MarkdownContent text="Stable quest link surface" sessionId="s1" questLinkSurface="legacy" />,
    );

    expect(mockMarkdownRenderCount.count).toBe(1);
    rerender(<MarkdownContent text="Stable quest link surface" sessionId="s1" questLinkSurface="legacy" />);
    expect(mockMarkdownRenderCount.count).toBe(1);

    rerender(<MarkdownContent text="Stable quest link surface" sessionId="s1" questLinkSurface="chat-feed" />);
    expect(mockMarkdownRenderCount.count).toBe(2);
  });
});
