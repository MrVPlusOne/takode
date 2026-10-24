// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";
import { InlineLocalImagesContext } from "./inline-local-images.js";

/**
 * Topic pages show Markdown images with local paths inline, as chat shows them as thumbnails; the
 * image is read through the page's session (for a remote host's files), and its URL carries a
 * refresh key so a plot rewritten in place shows its current version. Elsewhere such an image
 * stays a link.
 */
describe("inline local images", () => {
  it("shows a local Markdown image inline on surfaces that ask for it", () => {
    render(
      <InlineLocalImagesContext.Provider value={{ sessionId: "leader-1", refreshKey: "42" }}>
        <MarkdownContent text="![evals](/data/t7/evals.png)" />
      </InlineLocalImagesContext.Provider>,
    );
    const image = screen.getByTestId("inline-local-image").querySelector("img")!;
    const url = new URL(image.getAttribute("src")!, "http://x");
    expect(url.pathname).toBe("/api/fs/file-link/image");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      path: "/data/t7/evals.png",
      variant: "thumbnail",
      sessionId: "leader-1",
      v: "42",
    });
  });

  it("keeps it a link elsewhere", () => {
    render(<MarkdownContent text="![evals](/data/t7/evals.png)" />);
    expect(screen.queryByTestId("inline-local-image")).toBeNull();
  });
});
