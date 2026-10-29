// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));
vi.mock("../utils/copy-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/copy-utils.js")>()),
  copyRichText: vi.fn(async () => {}),
}));

import { MarkdownContent } from "./MarkdownContent.js";
import { ArtifactMarkersContext } from "./ArtifactInline.js";
import { formatArtifactPlaceholder, type ArtifactMessageMarker } from "../../shared/artifact-library.js";
import { useStore } from "../store.js";
import { useLibraryNav } from "../utils/library-nav.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { markLeaderThreadDisplayed } from "../utils/thread-viewport.js";

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

  it("opens a saved draft in the Library from its More menu, and says when a copy was sent again", () => {
    // The header opens the draft full screen; the Library (the less common place) is in More,
    // naming the version when there are several.
    render(
      <ArtifactMarkersContext.Provider value={[{ ...POST, version: 3 }]}>
        <MarkdownContent text={"```draft\ntitle: T7 thread update\n---\nQuick T7 update\n```"} />
      </ArtifactMarkersContext.Provider>,
    );
    expect(screen.getByTestId("card-more-menu").closest("[data-markdown-draft]")).not.toBeNull();
    fireEvent.click(screen.getByTestId("card-more-menu"));
    expect(screen.getByRole("button", { name: "Open version 3 of 3 in Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export as Markdown (.md)" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-more-menu"));

    // A view without markers (read-only) has no Library item.
    render(<MarkdownContent text={"```draft\ntitle: Other\n---\nText\n```"} />);
    fireEvent.click(screen.getAllByTestId("card-more-menu")[1]!);
    expect(screen.queryByRole("button", { name: /in Library/ })).not.toBeInTheDocument();

    render(
      <MarkdownContent text={formatArtifactPlaceholder({ ...POST, version: 3, versionCount: 3, repeated: true })} />,
    );
    expect(screen.getByText(/version 3, sent again later/)).toBeInTheDocument();
  });

  it("opens an artifact in the side column of the leader on screen, from a card's More menu or an open-in-side click", () => {
    // Beside the conversation instead of the Library; only while a leader's conversation is on screen.
    useStore.setState({ currentSessionId: "l1" });
    const shown = markLeaderThreadDisplayed("l1", "q-7");
    try {
      render(
        <ArtifactMarkersContext.Provider value={[POST]}>
          <MarkdownContent
            text={
              "```draft\ntitle: T7 thread update\n---\nQuick T7 update\n```\n\nSee [the report](artifact:0f1e2d3c:v4)."
            }
          />
        </ArtifactMarkersContext.Provider>,
      );
      fireEvent.click(screen.getByTestId("card-more-menu"));
      fireEvent.click(screen.getByRole("button", { name: "Open in side column" }));
      expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
        expect.objectContaining({ kind: "artifact", artifactId: "artifact-1", version: 2, title: "T7 thread update" }),
      ]);

      // Shift-click on an artifact link (the default open-in-side click) leaves the Library closed.
      fireEvent.click(screen.getByTestId("artifact-inline-link"), { shiftKey: true });
      expect(useSideColumnStore.getState().columns.l1!.items[0]).toEqual(
        expect.objectContaining({ kind: "artifact", artifactId: "0f1e2d3c", version: 4 }),
      );
      expect(useLibraryNav.getState().artifactId).toBeNull();
    } finally {
      shown();
      useSideColumnStore.setState({ columns: {} });
      useStore.setState({ currentSessionId: null });
      localStorage.clear();
    }
  });

  it("shows a post's message and replies as one card, with marks, attachments and removed parts", async () => {
    // The T7 status update before Wednesday: three blocks, the second with a figure, after a
    // revision that edited reply 1 and dropped a reply. One card, a Copy for Slack per part plus
    // Copy all, the figure under its part, and the dropped reply as a line that opens.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "post", parts: ["M", "R1", "R2", "Old dropped reply"], figureIds: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = [
      "```draft\ntitle: T7 status update before Wednesday\n---\n:update: T7 status\n```",
      "```draft\n384K vs 256K: level\nattach: /tmp/t7_vs_twin.png\n```",
      "```draft\nFYI eval jobs recovered\n```",
    ].join("\n\n");
    render(
      <ArtifactMarkersContext.Provider
        value={[
          {
            ...POST,
            title: "T7 status update before Wednesday",
            version: 2,
            versionCount: 2,
            changes: { parts: ["same", "edited", "same"], removed: [3] },
          },
        ]}
      >
        <MarkdownContent text={text} />
      </ArtifactMarkersContext.Provider>,
    );
    expect(screen.getAllByTestId("draft-post-card")).toHaveLength(1);
    const parts = screen.getAllByTestId("draft-post-part");
    expect(parts.map((part) => part.textContent)).toEqual([
      expect.stringContaining("Message"),
      expect.stringContaining("Reply 1edited"),
      expect.stringContaining("Reply 2"),
    ]);
    expect(screen.getAllByTestId("markdown-draft-copy")).toHaveLength(3);
    expect(screen.getByTestId("draft-post-copy-all")).toBeInTheDocument();
    expect(screen.getByTestId("draft-post-attachments").closest("[data-testid=draft-post-part]")).toBe(parts[1]);
    expect(screen.queryByText(/attach:/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Reply 3 removed/ }));
    await waitFor(() => expect(screen.getByText("Old dropped reply")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/artifact-1/versions/1", expect.anything());
  });

  it("shows a revision that names its parts as the whole saved version", async () => {
    // `part: 2` repeats only reply 1; the card loads the saved version so all parts show.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "post", parts: ["Message text", "New reply text"], figureIds: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const marker = { ...POST, version: 3, versionCount: 3, changes: { parts: ["same", "edited"], removed: [] } };
    render(
      <ArtifactMarkersContext.Provider value={[marker as ArtifactMessageMarker]}>
        <MarkdownContent text={"```draft\ntitle: T7 thread update\npart: 2\n---\nNew reply text\n```"} />
      </ArtifactMarkersContext.Provider>,
    );
    // Until the version loads, the named part shows on its own, marked edited.
    expect(screen.getByTestId("draft-post-card")).toHaveTextContent("New reply text");
    await waitFor(() => expect(screen.getByText("Message text")).toBeInTheDocument());
    expect(screen.getAllByTestId("draft-post-part")).toHaveLength(2);
  });

  it("links a post's destination in its header, from its to: line or its saved version", () => {
    render(
      <MarkdownContent
        text={
          "```draft\ntitle: Note\nto: [#ws-bc-coding thread](https://x.slack.com/archives/C1/p17)\n---\nHi Dan\n```"
        }
      />,
    );
    const link = screen.getByTestId("draft-post-destination");
    expect(link).toHaveTextContent("Post in #ws-bc-coding thread");
    expect(link).toHaveAttribute("href", "https://x.slack.com/archives/C1/p17");
    expect(link).toHaveAttribute("target", "_blank");
    // The header line isn't part of the message.
    expect(screen.queryByText(/to:/)).not.toBeInTheDocument();

    // A revision without a to: line still links the destination its version kept.
    render(
      <ArtifactMarkersContext.Provider
        value={[{ ...POST, title: "Revised note", destination: { url: "https://x.slack.com/archives/C9" } }]}
      >
        <MarkdownContent text={"```draft\ntitle: Revised note\n---\nHi again\n```"} />
      </ArtifactMarkersContext.Provider>,
    );
    expect(screen.getAllByTestId("draft-post-destination")[1]).toHaveTextContent("Post in Slack channel");
  });

  it("dims the Copy buttons of parts copied before, and records a copy on the server", async () => {
    // The server keeps what was copied (on every device); copying a part posts its index there,
    // and the button dims once the refreshed markers say so, still copying when clicked.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = "```draft\ntitle: T7 status\n---\nMessage\n```\n\n```draft\nReply\n```";
    const view = (copied?: number[]) => (
      <ArtifactMarkersContext.Provider value={[{ ...POST, title: "T7 status", ...(copied ? { copied } : {}) }]}>
        <MarkdownContent text={text} />
      </ArtifactMarkersContext.Provider>
    );
    const { rerender } = render(view());
    const copies = () => screen.getAllByTestId("markdown-draft-copy");
    expect(copies().filter((button) => button.hasAttribute("data-copied-before"))).toHaveLength(0);

    fireEvent.click(copies()[1]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/artifacts/artifact-1/versions/2/copied",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ parts: [1] }) }),
      ),
    );

    rerender(view([1]));
    expect(copies().map((button) => button.hasAttribute("data-copied-before"))).toEqual([false, true]);
    expect(screen.getByTestId("draft-post-copy-all")).not.toHaveAttribute("data-copied-before");
    fireEvent.click(screen.getByTestId("draft-post-copy-all"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/artifacts/artifact-1/versions/2/copied",
        expect.objectContaining({ body: JSON.stringify({ parts: [0, 1] }) }),
      ),
    );
    rerender(view([0, 1]));
    expect(screen.getByTestId("draft-post-copy-all")).toHaveAttribute("data-copied-before");
  });
});
