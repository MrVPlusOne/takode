// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";
import { ArtifactSavedLine } from "./ArtifactInline.js";
import { formatArtifactPlaceholder, type ArtifactMessageMarker } from "../../shared/artifact-library.js";

/**
 * How library artifacts show inside conversations: an older version arrives from the server as a
 * placeholder fence and renders as one collapsed line that loads its content only when shown; a
 * draft's `title:` header names it without being shown; the "Saved in Library" line appears for
 * posts and for other kinds once they have several versions.
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
    expect(screen.getByText(/version 2 of 3, replaced by a newer version/)).toBeInTheDocument();
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

  it("shows the Saved in Library line for posts, and for other kinds only with several versions", () => {
    const { rerender } = render(
      <ArtifactSavedLine
        markers={[
          { ...POST, version: 3 },
          {
            id: "f1",
            kind: "figure",
            title: "evals",
            version: 1,
            versionCount: 1,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("artifact-saved-line")).toHaveTextContent(
      "Saved in Library as T7 thread update, version 3 of 3",
    );
    expect(screen.queryByText("evals")).not.toBeInTheDocument();

    rerender(
      <ArtifactSavedLine
        markers={[
          {
            id: "f1",
            kind: "figure",
            title: "evals",
            version: 1,
            versionCount: 1,
          },
        ]}
      />,
    );
    expect(screen.queryByTestId("artifact-saved-line")).not.toBeInTheDocument();
  });
});
