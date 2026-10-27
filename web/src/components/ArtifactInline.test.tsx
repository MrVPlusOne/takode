// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";
import { ArtifactMarkersContext } from "./ArtifactInline.js";
import { formatArtifactPlaceholder, type ArtifactMessageMarker } from "../../shared/artifact-library.js";

/**
 * How library artifacts show inside conversations: an older version arrives from the server as a
 * placeholder fence and renders as one collapsed line that loads its content only when shown; a
 * draft's `title:` header names it without being shown; a saved draft carries its Library link in
 * its own header (the line under each saved artifact is gone).
 */

const POST: ArtifactMessageMarker = {
  id: "artifact-1",
  kind: "post",
  title: "T7 thread update",
  version: 2,
  versionCount: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artifacts in the feed", () => {
  it("collapses an older version and loads its parts only when shown", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kind: "post",
            parts: ["Old **draft** text"],
            figureIds: [],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<MarkdownContent text={`Here it was:\n\n${formatArtifactPlaceholder(POST)}`} />);

    expect(screen.getByText("T7 thread update")).toBeInTheDocument();
    expect(screen.getByText(/version 2 of 3, revised later/)).toBeInTheDocument();
    // Nothing is fetched until the user asks for it.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(screen.getByText("draft")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/versions/2", expect.anything());
  });

  it("names a draft by its title header without showing the header", () => {
    render(<MarkdownContent text={"```draft\ntitle: T7 thread update\n---\nQuick T7 update\n```"} />);
    expect(screen.getByText("T7 thread update")).toBeInTheDocument();
    expect(screen.getByText("Quick T7 update")).toBeInTheDocument();
    expect(screen.queryByText(/title:/)).not.toBeInTheDocument();
    expect(screen.queryByText("---")).not.toBeInTheDocument();
  });

  it("puts a saved draft's Library link in its card header, and says when a copy was sent again", () => {
    render(
      <ArtifactMarkersContext.Provider value={[{ ...POST, version: 3 }]}>
        <MarkdownContent text={"```draft\ntitle: T7 thread update\n---\nQuick T7 update\n```"} />
      </ArtifactMarkersContext.Provider>,
    );
    const link = screen.getByTestId("artifact-card-link");
    expect(link).toHaveTextContent("v3");
    expect(link).toHaveAccessibleName("Version 3 of 3 in Library");
    expect(link.closest("[data-markdown-draft]")).not.toBeNull();

    // A view without markers (read-only) shows the draft without a link.
    render(<MarkdownContent text={"```draft\ntitle: Other\n---\nText\n```"} />);
    expect(screen.getAllByTestId("artifact-card-link")).toHaveLength(1);

    render(
      <MarkdownContent text={formatArtifactPlaceholder({ ...POST, version: 3, versionCount: 3, repeated: true })} />,
    );
    expect(screen.getByText(/version 3, sent again later/)).toBeInTheDocument();
  });
});
