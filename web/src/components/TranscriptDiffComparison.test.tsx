// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import {
  buildTranscriptDiff,
  TRANSCRIPT_CHARACTER_DIFF_MAX_TOTAL_CODE_UNITS,
  TRANSCRIPT_WORD_DIFF_MAX_TOTAL_CODE_UNITS,
  TranscriptDiffComparison,
} from "./TranscriptDiffComparison.js";

describe("TranscriptDiffComparison", () => {
  it("highlights character-level replacements on their corresponding sides", () => {
    const { container } = render(
      <TranscriptDiffComparison
        originalLabel="Original STT output"
        replayLabel="Replay STT output"
        originalText="hello world"
        replayText="hello brave world"
      />,
    );

    expect(container.querySelector('[data-transcript-diff-kind="added"]')).toHaveTextContent("brave");
    expect(container.querySelector('[data-transcript-diff-kind="removed"]')).toBeNull();
    expect(screen.getByText("Character differences are highlighted.")).toHaveClass("sr-only");
  });

  it("renders identical and empty output without misleading highlights", () => {
    const { container, rerender } = render(
      <TranscriptDiffComparison
        originalLabel="Original"
        replayLabel="Replay"
        originalText="same text"
        replayText="same text"
      />,
    );
    expect(screen.getByText("Identical output")).toBeInTheDocument();
    expect(container.querySelector("mark")).toBeNull();

    rerender(
      <TranscriptDiffComparison originalLabel="Original" replayLabel="Replay" originalText="" replayText="added" />,
    );
    expect(screen.getByText("(empty)")).toBeInTheDocument();
    expect(container.querySelector('[data-transcript-diff-kind="added"]')).toHaveTextContent("added");
  });

  it("preserves Unicode and whitespace while bounding expensive character diffs", () => {
    const unicode = buildTranscriptDiff("café 👋\nnext", "cafe 👋🏽\n next");
    expect(unicode.mode).toBe("character");
    expect(unicode.original.map((span) => span.value).join("")).toBe("café 👋\nnext");
    expect(unicode.replay.map((span) => span.value).join("")).toBe("cafe 👋🏽\n next");

    const long = buildTranscriptDiff("a".repeat(2_500), "b".repeat(2_500));
    expect(long.mode).toBe("word");
    expect(long.original.map((span) => span.value).join("")).toHaveLength(2_500);
    expect(long.replay.map((span) => span.value).join("")).toHaveLength(2_500);
  });

  it("routes oversized inputs before character or word tokenization", () => {
    // A one-character edit would be a cheap character diff after tokenization; word mode proves the size gate ran first.
    const characterSideLength = Math.floor(TRANSCRIPT_CHARACTER_DIFF_MAX_TOTAL_CODE_UNITS / 2) + 1;
    const original = "a".repeat(characterSideLength);
    const replay = `${"a".repeat(characterSideLength - 1)}b`;
    expect(buildTranscriptDiff(original, replay).mode).toBe("word");

    // Inputs beyond the second gate stay exact but plain, avoiding full word tokenization too.
    const plainSideLength = Math.floor(TRANSCRIPT_WORD_DIFF_MAX_TOTAL_CODE_UNITS / 2) + 1;
    const plain = buildTranscriptDiff("a".repeat(plainSideLength), "b".repeat(plainSideLength));
    expect(plain.mode).toBe("unavailable");
    expect(plain.original[0].value).toHaveLength(plainSideLength);
    expect(plain.replay[0].value).toHaveLength(plainSideLength);
  });

  it("keeps skip-state labels plain instead of diffing them as transcript text", () => {
    const { container } = render(
      <TranscriptDiffComparison
        originalLabel="Original enhanced output"
        replayLabel="Replay enhanced output"
        originalText="(skipped: too short)"
        replayText="cleaned output"
        highlight={false}
      />,
    );
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText("(skipped: too short)")).toBeInTheDocument();
  });
});
