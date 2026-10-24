// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));

import type { ArtifactDetail, ArtifactSummary } from "../../../shared/artifact-library.js";
import { LibraryPage, groupByDay } from "./LibraryPage.js";
import { showLibraryArtifact } from "../../utils/library-nav.js";

/**
 * The Library page against a mocked API: it lists artifacts newest first under day headings,
 * sends the chosen filters to the server, and opens an artifact at its newest version with a
 * stepper back through older ones.
 */

const NOW = Date.now();

function summary(overrides: Partial<ArtifactSummary>): ArtifactSummary {
  return {
    id: "a1",
    kind: "post",
    title: "T7 thread update",
    space: "MSI",
    sessionId: "s1",
    threadKey: "q-2713",
    createdAt: NOW,
    updatedAt: NOW,
    starred: false,
    versionCount: 3,
    latest: {
      n: 3,
      at: NOW,
      bytes: 10,
      kept: true,
      source: {
        sessionId: "s1",
        messageId: "m3",
        threadKey: "q-2713",
        at: NOW,
      },
    },
    preview: "Quick T7 update",
    ...overrides,
  };
}

const POST = summary({});
const DETAIL: ArtifactDetail = {
  ...POST,
  versions: [1, 2, 3].map((n) => ({
    n,
    at: NOW - (3 - n) * 1000,
    bytes: 10,
    kept: true,
    parts: 1,
    source: {
      sessionId: "s1",
      messageId: `m${n}`,
      threadKey: "q-2713",
      at: NOW,
    },
  })),
};

let requests: string[];

beforeEach(() => {
  requests = [];
  showLibraryArtifact(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...DETAIL, starred: body.starred }));
      }
      if (url.startsWith("/api/artifacts?")) {
        return new Response(
          JSON.stringify({
            artifacts: [POST],
            total: 1,
            spaces: ["MSI", "Takode"],
          }),
        );
      }
      if (url === "/api/artifacts/a1") return new Response(JSON.stringify(DETAIL));
      if (url.startsWith("/api/topics")) return new Response(JSON.stringify({ topics: [], map: {} }));
      const version = /\/versions\/(\d+)$/.exec(url)?.[1];
      return new Response(
        JSON.stringify({
          kind: "post",
          parts: [`Draft version ${version}`],
          figureIds: [],
        }),
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

describe("LibraryPage", () => {
  it("browses one kind at a time, Figures first, and opens an artifact large with its versions", async () => {
    localStorage.removeItem("cc-library-kind");
    render(<LibraryPage />);
    const card = await screen.findByTestId("library-artifact-card");
    expect(requests[0]).toContain("kind=figure");
    expect(within(card).getByText("T7 thread update")).toBeInTheDocument();
    expect(screen.getByText("Today", { selector: "h3" })).toBeInTheDocument();

    // Another kind, then All (no kind filter), which also names each card's kind.
    fireEvent.click(screen.getByRole("tab", { name: "Posts" }));
    await waitFor(() => expect(requests.at(-1)).toContain("kind=post"));
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(requests.at(-1)).not.toContain("kind="));
    // All spaces are shown here, so cards name their space too.
    expect(await screen.findByText(`Post · v3 · MSI · ${clock(NOW)}`)).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("library-artifact-card")).getByText("T7 thread update"));
    expect(await screen.findByText("Draft version 3")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-id")).toHaveTextContent("a1");
    fireEvent.click(screen.getByRole("button", { name: "Older version" }));
    expect(await screen.findByText("Draft version 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ Library" }));
    expect(screen.getByTestId("library-gallery")).toBeVisible();
  });

  it("keeps search and filters behind one button, and says what is filtered", async () => {
    render(<LibraryPage />);
    await screen.findByTestId("library-artifact-card");
    fireEvent.click(screen.getByTestId("library-filter-button"));
    fireEvent.change(screen.getByLabelText("Search artifacts"), { target: { value: "t7" } });
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(requests.at(-1)).toMatch(/q=t7.*|since=/));
    await waitFor(() => expect(requests.at(-1)).toContain("q=t7"));
    expect(screen.getByTestId("library-active-filters")).toHaveTextContent("“t7” · Last 7 days");
    fireEvent.click(within(screen.getByTestId("library-active-filters")).getByText("Clear"));
    await waitFor(() => expect(requests.at(-1)).not.toContain("q=t7"));
  });

  it("stars a card from the grid and filters to starred cards from a toggle beside Filter", async () => {
    render(<LibraryPage />);
    const card = await screen.findByTestId("library-artifact-card");
    expect(card).not.toHaveAttribute("data-starred");
    fireEvent.click(within(card).getByRole("button", { name: "Star T7 thread update" }));
    // The card shows the server's answer, marked starred, without opening the artifact.
    await waitFor(() => expect(screen.getByTestId("library-artifact-card")).toHaveAttribute("data-starred", "true"));
    expect(screen.queryByTestId("artifact-viewer")).toBeNull();

    const toggle = screen.getByTestId("library-starred-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(requests.at(-1)).toContain("starred=1"));
    // Starred has its own toggle, so the Filter button doesn't look pressed for it.
    expect(screen.getByTestId("library-filter-button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("library-filter-button").className).not.toContain("bg-cc-primary/10");
  });

  it("groups rows by day of their last change", () => {
    const day = 24 * 3600_000;
    const groups = groupByDay(
      [
        summary({ id: "a", updatedAt: NOW }),
        summary({ id: "b", updatedAt: NOW - day }),
        summary({ id: "c", updatedAt: NOW - 5 * day }),
      ],
      NOW,
    );
    expect(groups.map((group) => [group.label, group.artifacts.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 1],
      [expect.any(String), 1],
    ]);
  });
});
