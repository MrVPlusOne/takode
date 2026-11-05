// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));

import type { ArtifactDetail, ArtifactVersionContent } from "../../../shared/artifact-library.js";
import { ArtifactViewer } from "./ArtifactViewer.js";

/**
 * Download and Export for artifacts the Library shows without a card of their own. A report or
 * table gets the same menu as a viewed Markdown file: Download (its Markdown as written) and the
 * exports report cards have. A figure gets a plain Download of its image. Posts, visuals and
 * decks keep theirs in their card's More menu, so the header shows none for them.
 */

const NOW = Date.now();

function detail(kind: ArtifactDetail["kind"]): ArtifactDetail {
  const source = { sessionId: "s1", messageId: "m1", threadKey: "q-1", at: NOW };
  const version = { n: 1, at: NOW, bytes: 10, kept: true, source };
  return {
    id: "a1",
    kind,
    title: "Weekly eval summary",
    space: "Takode",
    sessionId: "s1",
    threadKey: "q-1",
    createdAt: NOW,
    updatedAt: NOW,
    starred: false,
    versionCount: 1,
    latest: version,
    preview: "",
    versions: [version],
  };
}

let content: ArtifactVersionContent;
let artifact: ArtifactDetail;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/artifacts/a1") return new Response(JSON.stringify(artifact));
    if (url.startsWith("/api/artifacts/a1/versions/")) return new Response(JSON.stringify(content));
    if (url === "/api/exports/document") return new Response("%PDF-");
    return new Response(JSON.stringify({ topics: [], map: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("ArtifactViewer Download", () => {
  it("offers Download and the report exports for a report, made from the report as shown", async () => {
    artifact = detail("report");
    content = { kind: "report", markdown: "# Weekly eval summary\n\nPass rate rose to 81%." };
    const createObjectURL = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    render(<ArtifactViewer id="a1" />);

    await screen.findByText("Pass rate rose to 81%.");
    fireEvent.click(screen.getByRole("button", { name: "Download or export" }));
    for (const name of [
      "Download (.md)",
      "Export as PDF (.pdf)",
      "Export as image (.png)",
      "Export as web page (.html)",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Export as PDF (.pdf)" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/exports/document") as [string, RequestInit];
    const body = JSON.parse(String(call[1].body)) as { html: string; format: string };
    expect(body.format).toBe("pdf");
    expect(body.html).toContain("Pass rate rose to 81%.");
  });

  it("downloads a figure's image under its own file name", async () => {
    artifact = detail("figure");
    content = { kind: "figure", path: "/home/coder/plots/pass-rate.png", fileUrl: "/api/artifacts/a1/file" };
    const clicked: Array<{ href: string; download: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute("href") ?? "", download: this.download });
    });
    render(<ArtifactViewer id="a1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    expect(clicked).toEqual([{ href: "/api/artifacts/a1/file", download: "pass-rate.png" }]);
    click.mockRestore();
  });

  it("shows no header Download for a post, whose card has its own", async () => {
    artifact = detail("post");
    content = { kind: "post", parts: ["Quick update"], figureIds: [] };
    render(<ArtifactViewer id="a1" />);

    await screen.findByText("Quick update");
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument();
  });
});
