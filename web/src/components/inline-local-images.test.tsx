// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));
// The real viewer downloads the image before showing it; these tests only check which image it opens.
vi.mock("./Lightbox.js", () => ({
  Lightbox: ({ src, alt }: { src: string; alt?: string }) => <img data-testid="viewer" src={src} alt={alt} />,
}));

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
    const image = screen.getByTestId("viewable-image").querySelector("img")!;
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
    expect(screen.queryByTestId("viewable-image")).toBeNull();
  });

  it("opens a local image full size in the image viewer on click", () => {
    render(
      <InlineLocalImagesContext.Provider value={{ sessionId: "leader-1", refreshKey: "42" }}>
        <MarkdownContent text="![evals](/data/t7/evals.png)" />
      </InlineLocalImagesContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("viewable-image"));
    const full = screen.getByTestId("viewer");
    expect(new URL(full.getAttribute("src")!, "http://x").searchParams.get("variant")).toBe("full");
  });
});

/**
 * Every image embedded in Markdown opens in the image viewer on click or tap, including URL images
 * such as the server image links Scribes write into topic pages, except an image inside a link,
 * which follows its link.
 */
describe("click-to-view Markdown images", () => {
  it("opens a URL image in the image viewer", () => {
    const src = "/api/fs/file-link/image?path=%2Fdata%2Fplot.png&isRelative=0&variant=full";
    render(<MarkdownContent text={`![T7 evals](${src})`} />);
    fireEvent.click(screen.getByTestId("viewable-image"));
    const full = screen.getByTestId("viewer");
    expect(full.getAttribute("src")).toBe(src);
    expect(full.getAttribute("alt")).toBe("T7 evals");
  });

  it("keeps the viewer open when the Markdown renders again", () => {
    // Markdown's components are recreated on every render, so the viewer must not live inside
    // them: a topic page re-rendered (a new context value) and closed it a moment after opening.
    const page = (refreshKey: string) => (
      <InlineLocalImagesContext.Provider value={{ sessionId: "leader-1", refreshKey }}>
        <MarkdownContent text="![T7 evals](https://example.com/evals.png)" />
      </InlineLocalImagesContext.Provider>
    );
    const { rerender } = render(page("1"));
    fireEvent.click(screen.getByTestId("viewable-image"));
    rerender(page("2"));
    expect(screen.getByTestId("viewer").getAttribute("src")).toBe("https://example.com/evals.png");
  });

  it("does not let the click reach a clickable surface around the Markdown", () => {
    const onSurfaceClick = vi.fn();
    render(
      <div onClick={onSurfaceClick}>
        <MarkdownContent text="![chart](https://example.com/chart.png)" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("viewable-image"));
    expect(onSurfaceClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("viewer")).toBeTruthy();
  });

  it("leaves an image inside a link to the link", () => {
    const { container } = render(
      <MarkdownContent text="[![build](https://example.com/badge.svg)](https://example.com/ci)" />,
    );
    expect(screen.queryByTestId("viewable-image")).toBeNull();
    expect(container.querySelector('a[href="https://example.com/ci"] img')).toBeTruthy();
  });
});
