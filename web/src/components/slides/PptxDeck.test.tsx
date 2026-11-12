// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactVersionContent } from "../../../shared/artifact-library.js";
import { PptxDeck } from "./PptxDeck.js";

/**
 * A published PowerPoint deck in the Library: slides with pictures show their picture, slides
 * without one show their text (as written, not read as Markdown), notes show under the slide, and
 * the deck controls page through it.
 */

afterEach(() => vi.restoreAllMocks());

const CONTENT: Extract<ArtifactVersionContent, { kind: "pptx" }> = {
  kind: "pptx",
  name: "fv_weekly.pptx",
  bytes: 581_959,
  fileUrl: "/api/artifacts/a1/versions/1/file",
  slides: [
    {
      title: "FV weekly",
      text: "",
      notes: "Open with the headline.",
      pictureUrl: "/api/artifacts/a1/versions/1/slides/1",
    },
    { title: "", text: "Results *so far*\n- 31% → 44%", notes: "" },
  ],
};

function show() {
  // A wide box, so slides show on the 16:9 stage.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  return render(
    <PptxDeck
      content={CONTENT}
      title="FV weekly"
      renderMarkdown={(text) => <div className="markdown-body">{text}</div>}
    />,
  );
}

describe("PptxDeck", () => {
  it("shows a slide's picture with its notes, then a slide without one as its text", () => {
    show();
    expect(screen.getByText("2 slides · fv_weekly.pptx · 568 KB")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-slide-picture")).toHaveAttribute("src", CONTENT.slides[0]!.pictureUrl);
    expect(screen.getByTestId("slide-notes")).toHaveTextContent("Open with the headline.");

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.queryByTestId("pptx-slide-picture")).not.toBeInTheDocument();
    // The text is escaped so Markdown shows it as written: no emphasis, no list.
    expect(screen.getByTestId("slide-stage")).toHaveTextContent("Results \\*so far\\*");
    expect(screen.getByTestId("slide-stage")).toHaveTextContent("\\- 31% → 44%");
    expect(screen.queryByTestId("slide-notes")).not.toBeInTheDocument();
  });
});
