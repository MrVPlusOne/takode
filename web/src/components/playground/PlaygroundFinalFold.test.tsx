// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaderThreadResponseState } from "../../../server/leader-thread-response.js";
import { useStore } from "../../store.js";
import { buildFinalFoldWindow, finalFoldFixture as fixture } from "../../test-fixtures/final-fold.js";
import { PlaygroundFinalFold } from "./PlaygroundFinalFold.js";

vi.mock("../../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"final-fold"' }) },
}));

const PROGRESS = "The pilot is building its task images on the cluster.";
const ANSWER = /The pilot is published and validated/;
const AFTER = "The worker is launching the two model runs now.";

beforeEach(() => useStore.getState().reset());

describe("Playground folded latest turn", () => {
  it("keeps the retained fixture aligned with the server's answer authority", () => {
    // The fixture's answer was finalized by the server producer; rebuilding its projection
    // must give the same answer state, so the Playground cannot invent answer authority.
    const state = buildLeaderThreadResponseState(
      { id: fixture.sessionId, messageHistory: fixture.history },
      fixture.threadKey,
    ).projection;
    expect(state).toEqual(fixture.projection);
    const sync = buildFinalFoldWindow();
    expect(sync.threadResponseSupportComplete).toBe(true);
    expect(sync.threadResponseProjection?.currentAnswers.map((row) => row.currentMessageId)).toEqual(["fold-answer"]);
  });

  it("folds the progress before the answer, keeps the later note open, and expands on demand", () => {
    render(<PlaygroundFinalFold />);
    const section = screen.getByTestId("playground-final-fold");
    expect(within(section).queryByText(PROGRESS)).not.toBeInTheDocument();
    expect(within(section).getByText(ANSWER)).toBeInTheDocument();
    expect(within(section).getByText(AFTER)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: /Show turn activity/ }));
    expect(within(section).getByText(PROGRESS)).toBeInTheDocument();
    expect(within(section).getByText(AFTER)).toBeInTheDocument();
  });
});
