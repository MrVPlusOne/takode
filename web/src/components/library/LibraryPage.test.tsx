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
    vi.fn(async (url: string) => {
      requests.push(url);
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

describe("LibraryPage", () => {
  it("lists artifacts, filters by kind, and steps through an artifact's versions", async () => {
    render(<LibraryPage />);
    const row = await screen.findByTestId("library-artifact-row");
    expect(within(row).getByText("T7 thread update")).toBeInTheDocument();
    expect(row).toHaveTextContent("Post · v3");
    expect(screen.getByText("Today", { selector: "div" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Kind"), {
      target: { value: "report" },
    });
    await waitFor(() => expect(requests.some((url) => url.includes("kind=report"))).toBe(true));

    fireEvent.click(row);
    expect(await screen.findByText("Draft version 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older version" }));
    expect(await screen.findByText("Draft version 2")).toBeInTheDocument();
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
