// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";

const mockGetQuestValidated = vi.fn();
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: (...args: unknown[]) => mockGetQuestValidated(...args),
    getSettings: vi.fn().mockResolvedValue({ editorConfig: { editor: "none" } }),
    getQuest: vi.fn().mockResolvedValue(null),
    getQuestCommit: vi.fn(),
    getQuestMemoryCommit: vi.fn(),
    questImageUrl: (id: string) => `/api/quests/_images/${id}`,
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
  },
}));

import { QuestDetailPanel } from "./QuestDetailPanel.js";

function makeFeedbackQuest(): QuestmasterTask {
  const journeyRun = (runId: string, createdAt: number) => ({
    runId,
    source: "board" as const,
    phaseIds: ["work" as const],
    status: "completed" as const,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    phaseOccurrences: [
      {
        occurrenceId: `${runId}:p1`,
        phaseId: "work" as const,
        phaseIndex: 0,
        phasePosition: 1,
        phaseOccurrence: 1,
        status: "completed" as const,
      },
    ],
  });
  const feedback = (runId: string, text: string) => ({
    author: "agent" as const,
    kind: "phase_summary" as const,
    text,
    tldr: `${text} TLDR`,
    ts: 1,
    journeyRunId: runId,
    phaseOccurrenceId: `${runId}:p1`,
    phaseId: "work" as const,
    phasePosition: 1,
    phaseOccurrence: 1,
  });
  return {
    id: "q-1966-v1",
    questId: "q-1966",
    version: 1,
    title: "Feedback navigation hydration",
    status: "refined",
    description: "Reveal exact feedback after full detail loads.",
    createdAt: 1,
    journeyRuns: [journeyRun("run-1", 1), journeyRun("run-2", 2)],
    feedback: [
      {
        ...feedback("run-1", "Older Work feedback body"),
        images: [
          { id: "desktop", filename: "desktop.png", mimeType: "image/png", path: "/tmp/desktop.png" },
          { id: "mobile", filename: "mobile.jpeg", mimeType: "image/jpeg", path: "/tmp/mobile.jpeg" },
        ],
      },
      feedback("run-2", "Latest Work feedback body"),
      { author: "agent", text: "Unscoped agent feedback", ts: 3 },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

describe("QuestDetailPanel feedback navigation lifecycle", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockGetQuestValidated.mockReset();
    mockGetQuestValidated.mockResolvedValue({ status: "not-modified", etag: null });
    window.history.replaceState(null, "", "#/");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  it("reveals a target that exists only after full quest detail hydration", async () => {
    const fullQuest = makeFeedbackQuest();
    const previewQuest = { ...fullQuest, feedback: [] };
    const request = deferred<{ status: "fresh"; data: QuestmasterTask; etag: string | null }>();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    mockGetQuestValidated.mockReturnValueOnce(request.promise);
    useStore.setState({
      quests: [previewQuest],
      questOverlayId: fullQuest.questId,
      questOverlayFeedbackTarget: { index: 0, requestId: 1 },
    });

    render(<QuestDetailPanel />);
    expect(document.querySelector('[data-feedback-index="0"]')).toBeNull();
    request.resolve({ status: "fresh", data: fullQuest, etag: "full-v1" });

    await waitFor(() => expect(document.querySelector('[data-feedback-index="0"]')).toBeInTheDocument());
    const target = document.querySelector<HTMLElement>('[data-feedback-index="0"]')!;
    expect(target).toHaveAttribute("data-feedback-highlighted", "true");
    expect(target.querySelector("details")).toHaveAttribute("open");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    // Producer-proven feedback attachments stay associated with the exact
    // target, reserve slots immediately, and preserve source order.
    const imageGroup = within(target).getByTestId("phase-note-image-thumbnails");
    expect(within(imageGroup).getByRole("button", { name: "Loading image desktop.png" })).toBeDisabled();
    expect(within(imageGroup).getByRole("button", { name: "Loading image mobile.jpeg" })).toBeDisabled();
    const thumbnails = within(imageGroup).getAllByTestId("image-preview-thumbnail-image");
    expect(thumbnails.map((image) => image.getAttribute("src"))).toEqual([
      "/api/quests/_images/desktop",
      "/api/quests/_images/mobile",
    ]);
    fireEvent.load(thumbnails[1]!);
    fireEvent.load(thumbnails[0]!);
    const imageButtons = within(imageGroup).getAllByRole("button");
    expect(imageButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open image desktop.png",
      "Open image mobile.jpeg",
    ]);

    fireEvent.click(imageButtons[0]!);
    expect(screen.getByRole("dialog", { name: "Image preview: desktop.png" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("dialog", { name: "Image preview: mobile.jpeg" })).toBeVisible();
  });

  it("reopens the same target and expires only its highlight without shifting or collapsing it", async () => {
    vi.useFakeTimers();
    const quest = makeFeedbackQuest();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    useStore.setState({ quests: [quest], questOverlayId: quest.questId });

    render(<QuestDetailPanel />);
    act(() => useStore.getState().openQuestOverlay(quest.questId, undefined, 0));
    await act(async () => {});
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => useStore.getState().openQuestOverlay(quest.questId, undefined, 0));
    await act(async () => {});
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    let target = document.querySelector<HTMLElement>('[data-feedback-index="0"]')!;
    expect(target).toHaveAttribute("data-feedback-highlighted", "true");

    act(() => vi.advanceTimersByTime(2600));
    target = document.querySelector<HTMLElement>('[data-feedback-index="0"]')!;
    expect(target).toHaveAttribute("data-feedback-highlighted", "false");
    expect(target.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps an unscoped agent card's layout geometry while its highlight expires", () => {
    vi.useFakeTimers();
    const quest = makeFeedbackQuest();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    useStore.setState({ quests: [quest], questOverlayId: quest.questId });

    render(<QuestDetailPanel />);
    act(() => useStore.getState().openQuestOverlay(quest.questId, undefined, 2));
    let target = document.querySelector<HTMLElement>('[data-feedback-index="2"]')!;
    expect(target).toHaveClass("ml-4");
    expect(target).toHaveAttribute("data-feedback-highlighted", "true");

    act(() => vi.advanceTimersByTime(2600));
    target = document.querySelector<HTMLElement>('[data-feedback-index="2"]')!;
    expect(target).toHaveClass("ml-4");
    expect(target).toHaveAttribute("data-feedback-highlighted", "false");
  });
});
