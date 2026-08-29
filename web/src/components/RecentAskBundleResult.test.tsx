// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecentAskBundle } from "../api.js";
import { RecentAskBundleResult } from "./RecentAskBundleResult.js";

describe("RecentAskBundleResult", () => {
  it("keeps math delimiters literal in the intentional exact-preview surface", () => {
    // A Recent destination is a compact source preview, not a shared Markdown surface.
    // Adding KaTeX to MarkdownContent must not silently change this boundary.
    const preview = "Compare $x_i$ with \\(y_i\\) and \\[z_i\\].";
    const bundle: RecentAskBundle = {
      id: "recent-math",
      sessionId: "session-math",
      sessionNum: 42,
      sessionName: "Math session",
      archived: false,
      sessionSpaceId: "takode",
      sessionSpaceName: "Takode",
      ownerThreadKey: "main",
      firstAskedAt: Date.now(),
      lastAskedAt: Date.now(),
      members: [
        {
          messageId: "message-math",
          historyIndex: 7,
          timestamp: Date.now(),
          preview,
          truncated: false,
          imageCount: 0,
        },
      ],
      status: "responded",
    };

    const { container } = render(
      <RecentAskBundleResult
        bundle={bundle}
        selected={false}
        onPointerMove={vi.fn()}
        onOpenMember={vi.fn()}
        onNavigateQuest={vi.fn()}
      />,
    );

    expect(screen.getByTestId("recent-ask-text").textContent).toBe(preview);
    expect(screen.getByRole("button", { name: "Open newest message in #42 Math session Main" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open ask/ })).toBeNull();
    expect(container.querySelector(".katex")).toBeNull();
  });
});
