// @vitest-environment jsdom
/**
 * The Quest complete card twinkles once when it shows moments after its quest finished,
 * whether the user watched the quest finish or opened its thread right after. Completions
 * from the past, and reopening the card later, stay quiet.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";

const sparkle = vi.hoisted(() => vi.fn());
vi.mock("./completion-celebration.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./completion-celebration.js")>()),
  playSparkle: sparkle,
}));
vi.mock("./MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({ questId }: { questId: string }) => <span>{questId}</span>,
}));

import { _resetArrivalsForTest } from "./completion-celebration.js";
import { QuestCompletionSummaryCard } from "./QuestCompletionSummaryCard.js";
import { QuestRecordFetchContext } from "./QuestSummaryCard.js";

function quest(overrides: Record<string, unknown>): QuestmasterTask {
  return {
    id: "q-1-v3",
    questId: "q-1",
    version: 3,
    title: "Ship the thing",
    createdAt: 1,
    status: "in_progress",
    description: "",
    ...overrides,
  } as unknown as QuestmasterTask;
}

function showQuest(record: QuestmasterTask) {
  act(() => useStore.setState({ quests: [record] }));
}

const renderCard = () =>
  render(
    <QuestRecordFetchContext.Provider value={false}>
      <QuestCompletionSummaryCard questId="q-1" questLinkSurface="legacy" />
    </QuestRecordFetchContext.Provider>,
  );

beforeEach(() => {
  _resetArrivalsForTest();
  sparkle.mockClear();
});
afterEach(() => {
  cleanup();
  useStore.setState({ quests: [] });
});

describe("QuestCompletionSummaryCard sparkle", () => {
  it("twinkles once when the quest finishes while the card is in view", () => {
    showQuest(quest({ status: "in_progress" }));
    renderCard();
    expect(screen.queryByTestId("quest-completion-summary")).toBeNull();

    showQuest(quest({ status: "done", completedAt: Date.now(), debriefTldr: "Shipped." }));
    expect(screen.getByTestId("quest-completion-summary")).toBeTruthy();
    expect(sparkle).toHaveBeenCalledTimes(1);

    // Showing the same completion again, as after the feed remounts the card, stays quiet.
    cleanup();
    renderCard();
    expect(sparkle).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a quest that finished in the past", () => {
    showQuest(quest({ status: "done", completedAt: Date.now() - 3_600_000, debriefTldr: "Shipped." }));
    renderCard();
    expect(screen.getByTestId("quest-completion-summary")).toBeTruthy();
    expect(sparkle).not.toHaveBeenCalled();
  });
});
