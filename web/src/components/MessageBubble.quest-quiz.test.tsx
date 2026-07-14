// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ChatMessage } from "../types.js";

const revertToMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
const starMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
const unstarMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
const markNotificationDoneMock = vi.hoisted(() => vi.fn(async () => ({})));
const getQuestValidatedMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    revertToMessage: revertToMessageMock,
    starMessage: starMessageMock,
    unstarMessage: unstarMessageMock,
    markNotificationDone: markNotificationDoneMock,
    getQuestValidated: getQuestValidatedMock,
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return "/api/fs/image?" + params.toString();
    },
  },
}));

vi.mock("react-markdown", () => ({
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: { p?: (props: { children: string }) => ReactNode };
  }) => {
    if (components?.p) {
      return <div data-testid="markdown">{components.p({ children })}</div>;
    }
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { useStore } from "../store.js";
import { MessageBubble } from "./MessageBubble.js";

beforeEach(() => {
  getQuestValidatedMock.mockReset();
  useStore.setState({ quests: [], questDetails: new Map(), questDetailEtags: new Map() });
});

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: "msg-" + Math.random().toString(36).slice(2, 8),
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageBubble quest quiz directives", () => {
  it("renders a quest quiz directive inline after assistant completion text", () => {
    // Completion summaries can include this hidden directive so the feed shows active-recall Q/A in place.
    useStore.setState({
      quests: [
        {
          questId: "q-8",
          title: "Add Quest Quiz Metadata",
          quizItems: [
            {
              id: "q8-purpose",
              question: "What is the core purpose of Quest Quiz metadata?",
              answer: "To attach active-recall Q/A to quests after agent work.",
              source: "q-8 scope",
            },
          ],
        } as any,
      ],
    });
    const msg = makeMessage({
      role: "assistant",
      content: "Status changed to done.\n\n{[(Quest Quiz: q-8)]}",
    });

    const { container } = render(<MessageBubble message={msg} />);

    expect(screen.getAllByTestId("markdown")[0]?.textContent).toBe("Status changed to done.");
    expect(screen.queryByText(/Quest Quiz:/i)).toBeNull();
    expect(screen.getByTestId("quest-quiz-inline").textContent).toContain("q-8");
    expect(screen.getByText("What is the core purpose of Quest Quiz metadata?")).toBeTruthy();
    expect(screen.getByText("To attach active-recall Q/A to quests after agent work.")).toBeTruthy();

    const answerDetails = container.querySelector("details") as HTMLDetailsElement | null;
    expect(answerDetails?.open).toBe(false);
    fireEvent.click(screen.getByText("Show answer"));
    expect(answerDetails?.open).toBe(true);
    expect(screen.getByText("To attach active-recall Q/A to quests after agent work.")).toBeTruthy();
  });

  it("renders quest quiz directives from assistant text content blocks", () => {
    useStore.setState({
      quests: [
        {
          questId: "q-42",
          title: "Finished quest",
          quizItems: [
            {
              id: "one",
              question: "Where should the quiz appear?",
              answer: "Inline after the completion summary.",
            },
          ],
        } as any,
      ],
    });
    const msg = makeMessage({
      role: "assistant",
      content: "",
      contentBlocks: [{ type: "text", text: "Final summary.\n\n{[(Quest Quiz: q-42)]}" }],
    });

    render(<MessageBubble message={msg} />);

    expect(screen.getAllByTestId("markdown")[0]?.textContent).toBe("Final summary.");
    expect(screen.getByTestId("quest-quiz-inline").textContent).toContain("q-42");
    expect(screen.getByText("Where should the quiz appear?")).toBeTruthy();
  });

  it("fetches quest quiz details when a directive references only preview quest data", async () => {
    // Real leader feeds often have only bounded preview quest rows when the
    // completion directive arrives; the directive itself should trigger a full
    // quest detail fetch so the hidden marker is replaced by the quiz card.
    getQuestValidatedMock.mockResolvedValueOnce({
      status: "fresh",
      etag: '"q-1801-detail"',
      data: {
        id: "q-1801-v2",
        questId: "q-1801",
        version: 2,
        title: "Fetched quiz quest",
        status: "done",
        createdAt: 1,
        quizItems: [
          {
            id: "q1801-root",
            question: "What data source should inline quiz directives use?",
            answer: "Full quest detail, not just the bounded preview quest list.",
          },
        ],
      },
    });
    useStore.setState({
      quests: [
        {
          preview: true,
          id: "q-1801-v2",
          questId: "q-1801",
          version: 2,
          title: "Preview quiz quest",
          status: "done",
          createdAt: 1,
        } as any,
      ],
    });
    const msg = makeMessage({
      role: "assistant",
      content: "Done.\n\n{[(Quest Quiz: q-1801)]}",
    });

    render(<MessageBubble message={msg} />);

    expect(screen.getAllByTestId("markdown")[0]?.textContent).toBe("Done.");
    expect(screen.queryByText(/Quest Quiz:/i)).toBeNull();
    const quiz = await screen.findByTestId("quest-quiz-inline");
    expect(quiz.textContent).toContain("q-1801");
    expect(screen.getByText("What data source should inline quiz directives use?")).toBeTruthy();
    expect(getQuestValidatedMock).toHaveBeenCalledWith("q-1801", null);
  });

  it("keeps empty quest quiz directives hidden without repeatedly fetching", async () => {
    // Some completed quests intentionally skip quiz metadata. A directive that
    // resolves empty should stay invisible and should not spin a fetch loop.
    getQuestValidatedMock.mockResolvedValueOnce({
      status: "fresh",
      etag: '"q-1802-empty"',
      data: {
        id: "q-1802-v1",
        questId: "q-1802",
        version: 1,
        title: "No quiz quest",
        status: "done",
        createdAt: 1,
      },
    });
    const msg = makeMessage({
      role: "assistant",
      content: "Done with no recall item.\n\n{[(Quest Quiz: q-1802)]}",
    });
    const view = render(<MessageBubble message={msg} />);

    expect(screen.queryByText(/Quest Quiz:/i)).toBeNull();
    await waitFor(() => expect(getQuestValidatedMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("quest-quiz-inline")).toBeNull();

    view.rerender(<MessageBubble message={msg} />);
    expect(screen.queryByText(/Quest Quiz:/i)).toBeNull();
    expect(screen.queryByTestId("quest-quiz-inline")).toBeNull();
    expect(getQuestValidatedMock).toHaveBeenCalledTimes(1);
  });
});
