// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));

import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";

/**
 * Gallery cards of slide decks: their thumbnail is a miniature of the first slide (the excerpt the
 * list sends), laid out as the slide is on the stage, and in a mixed gallery they are named as
 * slide decks.
 */

const NOW = Date.now();

function deck(excerpt: string): ArtifactSummary {
  return {
    id: "d1",
    kind: "deck",
    title: "Program verification evals",
    space: "MSI",
    sessionId: "s1",
    threadKey: "q-1",
    createdAt: NOW,
    updatedAt: NOW,
    starred: false,
    versionCount: 2,
    latest: {
      n: 2,
      at: NOW,
      bytes: 10,
      kept: true,
      source: { sessionId: "s1", messageId: "m", threadKey: "q-1", at: NOW },
    },
    preview: "",
    excerpt,
  };
}

describe("slide deck cards", () => {
  it("centres a title slide, names the kind, and shows the first slide's lines", () => {
    render(
      <ArtifactCard
        artifact={deck("# Program verification evals\n\n*November 10*")}
        showKind
        showSpace={false}
        onOpen={() => {}}
      />,
    );
    const slide = screen.getByTestId("slide-miniature");
    expect(slide).toHaveClass("justify-center", "text-center");
    expect(slide).toHaveTextContent("Program verification evals");
    expect(slide).toHaveTextContent("November 10");
    expect(screen.getByText(/^Slide deck · v2 · /)).toBeInTheDocument();
  });

  it("starts a slide that opens with a smaller heading from the top, with its bullets", () => {
    render(
      <ArtifactCard
        artifact={deck("## Three outcomes\n\n- 2 proved\n- 1 open")}
        showKind={false}
        showSpace={false}
        onOpen={() => {}}
      />,
    );
    const slide = screen.getByTestId("slide-miniature");
    expect(slide).not.toHaveClass("justify-center");
    expect(slide).toHaveTextContent("• 2 proved");
  });
});
