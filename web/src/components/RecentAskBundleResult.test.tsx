// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecentAskBundle } from "../api.js";
import { RecentAskBundleResult } from "./RecentAskBundleResult.js";

describe("RecentAskBundleResult", () => {
  it.each([
    { preview: "", imageCount: 2, commentCount: 0, description: "2 image attachments" },
    { preview: "", imageCount: 0, commentCount: 1, description: "1 comment attachment" },
    { preview: "", imageCount: 1, commentCount: 2, description: "1 image attachment, 2 comment attachments" },
    {
      preview: "Keep this exact text.\n  And its formatting.",
      imageCount: 1,
      commentCount: 2,
      description: "1 image attachment, 2 comment attachments",
    },
    { preview: "Plain text", imageCount: 0, commentCount: 0, description: "" },
  ])("keeps counts accessible and navigation unchanged ($imageCount images, $commentCount comments, $preview)", ({
    preview,
    imageCount,
    commentCount,
    description,
  }) => {
    // Counts come entirely from the supplied projection, without loaded session history.
    const member = {
      messageId: "newest",
      historyIndex: 7,
      timestamp: 100,
      preview,
      truncated: false,
      imageCount,
      commentCount,
    };
    const onOpenMember = vi.fn();
    render(
      <RecentAskBundleResult
        bundle={{
          id: "session:main",
          sessionId: "session",
          sessionNum: 42,
          sessionName: "Attachments",
          archived: false,
          sessionSpaceId: "default",
          sessionSpaceName: "Default",
          ownerThreadKey: "main",
          firstAskedAt: 100,
          lastAskedAt: 100,
          members: [member],
          status: "responded",
        }}
        selected={false}
        onPointerMove={vi.fn()}
        onOpenMember={onOpenMember}
        onNavigateQuest={vi.fn()}
      />,
    );
    const open = screen.getByRole("button", { name: "Open newest message in #42 Attachments Main" });
    expect(open).toHaveAccessibleDescription(description);
    expect(screen.queryAllByTitle(/image attachment/)).toHaveLength(imageCount > 0 ? 1 : 0);
    expect(screen.queryAllByTitle(/comment attachment/)).toHaveLength(commentCount > 0 ? 1 : 0);
    if (preview) expect(screen.getByTestId("recent-ask-text").textContent).toBe(preview);
    else expect(screen.queryByTestId("recent-ask-text")).toBeNull();
    if (preview.includes("\n")) {
      fireEvent.click(screen.getByRole("button", { name: "Expand newest message" }));
      expect(screen.getByTestId("recent-ask-text")).toHaveClass("whitespace-pre-wrap");
      expect(screen.getByTestId("recent-ask-text").textContent).toBe(preview);
      expect(open).toHaveAccessibleDescription(description);
    }
    fireEvent.click(open);
    expect(onOpenMember).toHaveBeenCalledWith(member);
  });

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
          commentCount: 0,
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
