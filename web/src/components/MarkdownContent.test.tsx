// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useStore } from "../store.js";

const mockGetSettings = vi.fn();
const mockOpenVsCodeRemoteFile = vi.fn();
const mockReadFile = vi.fn();
const mockFetchMessagePreview = vi.fn();
const mockGetQuestValidated = vi.fn();
const mockResolveFileLinkAction = vi.fn();
const mockRevealFileLinkInFinder = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    openVsCodeRemoteFile: (...args: unknown[]) => mockOpenVsCodeRemoteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    fetchMessagePreview: (...args: unknown[]) => mockFetchMessagePreview(...args),
    getQuestValidated: (...args: unknown[]) => mockGetQuestValidated(...args),
  },
}));

vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return {
    ...actual,
    resolveFileLinkAction: (...args: unknown[]) => mockResolveFileLinkAction(...args),
    revealFileLinkInFinder: (...args: unknown[]) => mockRevealFileLinkInFinder(...args),
  };
});

import { MarkdownContent } from "./MarkdownContent.js";

describe("MarkdownContent line breaks", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("renders visible line breaks for single newlines inside a paragraph", () => {
    // Validates the shared renderer respects soft line breaks for normal prose.
    const { container } = render(<MarkdownContent text={"First line\nSecond line"} />);

    const paragraph = container.querySelector("p");
    expect(paragraph).toBeTruthy();
    expect(paragraph?.querySelector("br")).toBeTruthy();
    expect(paragraph?.textContent).toBe("First line\nSecond line");
  });

  it("keeps markdown lists structured as lists while allowing soft breaks in list items", () => {
    // Guards against the newline fix flattening list syntax into plain paragraphs.
    const { container } = render(<MarkdownContent text={"Agenda:\n- first item\n- second item"} />);

    expect(screen.getByText("Agenda:")).toBeTruthy();
    const list = screen.getByRole("list");
    expect(list).toBeTruthy();
    expect(screen.getByText("first item")).toBeTruthy();
    expect(screen.getByText("second item")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("continues ordered-list numbering across bullet sublists", () => {
    // Reproduces the screenshot case where unindented bullet sublists split a single
    // logical ordered list into `[ol, ul, ol, ul]` sibling nodes in the markdown AST.
    const { container } = render(
      <MarkdownContent
        text={
          "What happened here was a combination of two things:\n\n1. Sessions became `idle` or `disconnected`\n\n- usually because of server restart or the idle manager killing the CLI process\n- that part is expected behaviour; disconnected sessions are supposed to be recoverable\n\n1. I failed to actively uninstall the board\n\n- q-362 stalled because the reviewer challenge existed, but I had not sent the required worker follow-up yet\n- q-427 stalled because the worker had already finished its investigation turn, but I had not advanced it into review\n"
        }
      />,
    );

    const markdownRoot = container.firstElementChild as HTMLElement | null;
    const orderedList = container.querySelector("ol");
    const orderedItems = orderedList?.querySelectorAll(":scope > li");
    const firstNestedList = orderedItems?.[0]?.querySelector(":scope > ul");
    const secondNestedList = orderedItems?.[1]?.querySelector(":scope > ul");

    expect(orderedList).toBeTruthy();
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(orderedItems).toHaveLength(2);
    expect(firstNestedList).toBeTruthy();
    expect(secondNestedList).toBeTruthy();
    expect(Array.from(markdownRoot?.children ?? []).filter((child) => child.tagName === "UL")).toHaveLength(0);
    expect(firstNestedList?.textContent).toContain(
      "usually because of server restart or the idle manager killing the CLI process",
    );
    expect(secondNestedList?.textContent).toContain(
      "q-427 stalled because the worker had already finished its investigation turn, but I had not advanced it into review",
    );
  });

  it("uses a compact readable rhythm for dense chat markdown", () => {
    // Protects the product-density target for long chat messages with wrapped prose,
    // bullets, nested bullets, numbered lists, and inline-code-heavy text.
    const { container } = render(
      <MarkdownContent
        text={
          "The feed should keep `inline-code-heavy` prose readable while using less vertical space across wrapped lines.\n\n- First finding wraps into a longer list item with `rollouts.jsonl` paths and counts that should not look airy.\n  - Nested detail keeps the same compact rhythm.\n- Second finding has another `dataset_id` value.\n\n1. Define the fixed default line height.\n2. Validate the screenshot before porting."
        }
      />,
    );

    const markdownRoot = container.firstElementChild as HTMLElement | null;
    const paragraph = container.querySelector("p");
    const unorderedList = container.querySelector("ul");
    const orderedList = container.querySelector("ol");
    const firstListItem = container.querySelector("li");
    const inlineCode = container.querySelector("p code");

    expect((markdownRoot as HTMLElement | null)?.style.lineHeight).toBe("1.45");
    expect(paragraph?.classList.contains("mb-2.5")).toBe(true);
    expect(unorderedList?.classList.contains("space-y-0.5")).toBe(true);
    expect(unorderedList?.classList.contains("mb-2.5")).toBe(true);
    expect(orderedList?.classList.contains("space-y-0.5")).toBe(true);
    expect((firstListItem as HTMLElement | null)?.style.lineHeight).toBe("1.45");
    expect(inlineCode?.className).toContain("font-mono-code");
    expect(inlineCode?.className).toContain("text-[13px]");
  });

  it("responds to the server-backed chat message line-height setting", () => {
    useStore.getState().setChatMessageLineHeight(1.62);

    const { container } = render(<MarkdownContent text={"Dense text\n\n- one\n- two"} />);

    const markdownRoot = container.firstElementChild as HTMLElement | null;
    const firstListItem = container.querySelector("li") as HTMLElement | null;
    expect(markdownRoot?.style.lineHeight).toBe("1.62");
    expect(firstListItem?.style.lineHeight).toBe("1.62");
  });

  it("preserves fenced code blocks while adding breaks only to surrounding prose", () => {
    // Ensures fenced code keeps raw newlines instead of being transformed into <br> tags.
    const { container } = render(
      <MarkdownContent text={"Summary line\nFollow-up line\n\n```ts\nconst x = 1;\nconst y = 2;\n```"} />,
    );

    const paragraph = container.querySelector("p");
    const code = container.querySelector("pre code");

    expect(paragraph?.querySelector("br")).toBeTruthy();
    expect(code?.querySelector("br")).toBeNull();
    expect(code?.textContent).toContain("const x = 1;\nconst y = 2;");
  });

  it("can wrap long inline and block code for constrained detail panels", () => {
    const longSha = "aa743fb345c5af4ac439f737d89e7a48d9da8090";
    const { container } = render(
      <MarkdownContent text={`Inline \`${longSha}\`\n\n\`\`\`\n${longSha}\n\`\`\``} wrapLongContent />,
    );

    const inlineCode = container.querySelector("p code");
    const codeBlock = container.querySelector("pre");

    expect(container.firstElementChild?.classList.contains("min-w-0")).toBe(true);
    expect(container.firstElementChild?.classList.contains("max-w-full")).toBe(true);
    expect(container.firstElementChild?.classList.contains("[overflow-wrap:anywhere]")).toBe(true);
    expect(inlineCode?.classList.contains("whitespace-normal")).toBe(true);
    expect(inlineCode?.classList.contains("break-all")).toBe(true);
    expect(codeBlock?.classList.contains("overflow-x-hidden")).toBe(true);
    expect(codeBlock?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(codeBlock?.classList.contains("break-words")).toBe(true);
    expect(codeBlock?.classList.contains("[overflow-wrap:anywhere]")).toBe(true);
  });
});

describe("MarkdownContent tables", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("adds a table-only view action without affecting normal markdown", () => {
    render(
      <div>
        <MarkdownContent text={"| Name | Role |\n| --- | --- |\n| Alice | Lead |"} />
        <MarkdownContent text={"Just a paragraph without any table syntax."} />
      </div>,
    );

    expect(screen.getByRole("button", { name: "View table" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Just a paragraph without any table syntax.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "View table" })).toHaveLength(1);
  });

  it("opens and closes the expanded table overlay", () => {
    render(
      <MarkdownContent
        text={"| Dataset | Path |\n| --- | --- |\n| v7 filtered long | /mnt/v7/long |\n| RTG | /mnt/rtg |"}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View table" }));

    const dialog = screen.getByTestId("markdown-table-dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId("markdown-table-backdrop")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getAllByText("RTG")).toHaveLength(2);
    expect(dialog.className).toContain("max-w-none");
    expect(dialog.className).toContain("h-[calc(100vh-2rem)]");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("markdown-table-dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "View table" }));
    fireEvent.click(screen.getByTestId("markdown-table-backdrop"));
    expect(screen.queryByTestId("markdown-table-dialog")).toBeNull();
  });
});

describe("MarkdownContent quest links", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.location.hash = "#/session/s1";
    useStore.getState().reset();
    mockGetSettings.mockReset();
    mockOpenVsCodeRemoteFile.mockReset();
    mockReadFile.mockReset();
    mockFetchMessagePreview.mockReset();
    mockGetQuestValidated.mockReset();
    mockResolveFileLinkAction.mockReset();
    mockRevealFileLinkInFinder.mockReset();
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "none" } });
    mockReadFile.mockResolvedValue({ path: "/tmp/file", content: "" });
    mockGetQuestValidated.mockImplementation(async (questId: string, etag?: string | null) => {
      const key = questId.toLowerCase();
      const state = useStore.getState();
      const quest = state.questDetails.get(key) ?? state.quests.find((item) => item.questId.toLowerCase() === key);
      if (!quest) throw new Error("Quest not found");
      return etag ? { status: "not-modified", etag } : { status: "fresh", data: quest, etag: '"test-detail"' };
    });
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/tmp/project/app.ts",
      requestedPath: "/tmp/project/app.ts",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: false,
      canRevealInFinder: false,
      platform: "linux",
    });
  });

  function setRepoSession({ isWorktree = false }: { isWorktree?: boolean } = {}) {
    useStore.setState((state) => ({
      ...state,
      currentSessionId: "s1",
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            cwd: isWorktree ? "/worktrees/repo-branch" : "/repo",
            repo_root: "/repo",
            is_worktree: isWorktree,
          } as never,
        ],
      ]),
    }));
  }

  it("opens quest links as overlay on the current route", () => {
    render(<MarkdownContent text="[q-42](quest:q-42)" />);

    const link = screen.getByRole("link", { name: "q-42" });
    // href is still set for right-click "open in new tab"
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-42");
    fireEvent.click(link);
    // Click opens the quest overlay instead of changing the hash
    expect(useStore.getState().questOverlayId).toBe("q-42");
    // Hash should NOT have changed (stays on current session)
    expect(window.location.hash).toBe("#/session/s1");
  });

  it("supports bare quest-id hrefs as a short schema", () => {
    render(<MarkdownContent text="[open](q-77)" />);

    const link = screen.getByRole("link", { name: "open" });
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-77");
    fireEvent.click(link);
    // Click opens the quest overlay instead of changing the hash
    expect(useStore.getState().questOverlayId).toBe("q-77");
    expect(window.location.hash).toBe("#/session/s1");
  });

  it("auto-links plain quest references with the rich quest link behavior", () => {
    render(<MarkdownContent text="Please review q-42 before merge." />);

    const link = screen.getByRole("link", { name: "q-42" });
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-42");
    fireEvent.click(link);
    expect(useStore.getState().questOverlayId).toBe("q-42");
  });

  it("auto-links plain session references with the rich session link behavior", () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
    }));

    render(<MarkdownContent text="Ask #123 to verify the UI." />);

    const link = screen.getByRole("link", { name: "#123" });
    expect(link.getAttribute("href")).toBe("#/session/123");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/session/session-abc");
  });

  it("does not auto-link plain references inside code or existing Markdown links", () => {
    render(<MarkdownContent text="Keep `q-77` literal and leave [#123](session:123) explicit." />);

    expect(screen.getByText("q-77").tagName).toBe("CODE");
    expect(screen.queryByRole("link", { name: "q-77" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "#123" }).getAttribute("href")).toBe("#");
  });

  it("shows QuestHoverCard content when hovering a quest link", async () => {
    useStore.setState((state) => ({
      ...state,
      quests: [
        {
          id: "q-42-v1",
          questId: "q-42",
          version: 1,
          title: "Fix auth race condition",
          createdAt: 1,
          status: "in_progress",
          description: "Ensure claim state updates atomically.",
          sessionId: "session-abc",
          claimedAt: 1,
          tags: ["ui", "bugfix"],
        },
      ],
    }));

    render(<MarkdownContent text="[q-42](quest:q-42)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "q-42" }));

    expect(await screen.findByText("Fix auth race condition")).toBeTruthy();
    expect(screen.getByTestId("quest-hover-card").style.width).toBe("560px");
    expect(screen.getByText("In Progress")).toBeTruthy();
    // The status row is separate so the pill cannot steal horizontal space from the title.
    expect(within(screen.getByTestId("quest-hover-status-row")).getByText("In Progress")).toBeTruthy();
    expect(screen.getByTestId("quest-hover-status-row").contains(screen.getByTestId("quest-hover-title"))).toBe(false);
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("bugfix")).toBeTruthy();
  });

  it("shows the owner session cross-link when hovering a claimed quest link", async () => {
    useStore.setState((state) => ({
      ...state,
      quests: [
        {
          id: "q-42-v1",
          questId: "q-42",
          version: 1,
          title: "Fix auth race condition",
          createdAt: 1,
          status: "in_progress",
          description: "Ensure claim state updates atomically.",
          sessionId: "session-abc",
          claimedAt: 1,
          tags: ["ui", "bugfix"],
        },
      ],
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
    }));

    render(<MarkdownContent text="[q-42](quest:q-42)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "q-42" }));

    expect(await screen.findByTestId("quest-hover-owner-session")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Owner session #123 Auth Worker" })).toBeTruthy();
    expect(screen.getByText("Auth Worker")).toBeTruthy();
  });

  it("shows leader attribution and full Journey data when hovering an orchestrated quest link", async () => {
    useStore.setState((state) => ({
      ...state,
      quests: [
        {
          id: "q-42-v1",
          questId: "q-42",
          version: 1,
          title: "Fix auth race condition",
          createdAt: 1,
          status: "in_progress",
          description: "Ensure claim state updates atomically.",
          sessionId: "session-abc",
          claimedAt: 1,
          tags: ["ui", "bugfix"],
        },
      ],
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
          herdedBy: "leader-abc",
        },
        {
          sessionId: "leader-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 7,
          isOrchestrator: true,
        },
        {
          sessionId: "reviewer-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 8,
        },
      ],
      sessionNames: new Map([
        ["session-abc", "Auth Worker"],
        ["leader-abc", "Quest Leader"],
        ["reviewer-abc", "Quest Reviewer"],
      ]),
      sessionBoards: new Map([
        [
          "leader-abc",
          [
            {
              questId: "q-42",
              status: "IMPLEMENTING",
              updatedAt: 2,
              journey: {
                mode: "active",
                phaseIds: ["alignment", "implement", "code-review"],
                currentPhaseId: "implement",
              },
            },
          ],
        ],
      ]),
      sessionBoardRowStatuses: new Map([
        [
          "leader-abc",
          {
            "q-42": {
              worker: { sessionId: "session-abc", sessionNum: 123, name: "Auth Worker", status: "running" },
              reviewer: { sessionId: "reviewer-abc", sessionNum: 8, name: "Quest Reviewer", status: "idle" },
            },
          },
        ],
      ]),
    }));

    render(<MarkdownContent text="[q-42](quest:q-42)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "q-42" }));

    // Leader can come from live herding metadata even when the quest record itself lacks leaderSessionId.
    expect(await screen.findByTestId("quest-hover-leader-session")).toBeTruthy();
    expect(
      within(screen.getByTestId("quest-hover-leader-session")).getByRole("link", {
        name: "Leader #7 Quest Leader",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Quest Leader")).toBeTruthy();
    expect(screen.getByTestId("quest-hover-worker-session").textContent).toContain("Worker");
    expect(screen.getByTestId("quest-hover-reviewer-session").textContent).toContain("Reviewer");
    expect(
      within(screen.getByTestId("quest-hover-worker-session")).getByRole("link", {
        name: "Worker #123 Auth Worker",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("quest-hover-reviewer-session")).getByRole("link", {
        name: "Reviewer #8 Quest Reviewer",
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId("quest-hover-owner-session")).toBeNull();
    expect(screen.getByTestId("quest-journey-preview-card")).toBeTruthy();
    expect(screen.getByTestId("quest-journey-timeline").getAttribute("data-journey-mode")).toBe("active");
    expect(screen.getByText("Active Journey")).toBeTruthy();
    expect(within(screen.getByTestId("quest-hover-status-row")).getByText("Implement")).toBeTruthy();
    expect(within(screen.getByTestId("quest-journey-timeline")).getByText("Implement")).toBeTruthy();
  });

  it("shows completed quests with the full completed Journey in the shared hover card", async () => {
    useStore.setState((state) => ({
      ...state,
      quests: [
        {
          id: "q-77-v1",
          questId: "q-77",
          version: 1,
          title: "Finish hover Journey",
          createdAt: 1,
          status: "done",
          description: "Completed quest with retained Journey metadata.",
          completedAt: 4,
          verificationItems: [],
        },
      ],
      sessionCompletedBoards: new Map([
        [
          "leader-abc",
          [
            {
              questId: "q-77",
              title: "Finish hover Journey",
              status: "PORTING",
              updatedAt: 3,
              completedAt: 4,
              journey: {
                mode: "active",
                phaseIds: ["alignment", "implement", "code-review", "port"],
                currentPhaseId: "port",
              },
            },
          ],
        ],
      ]),
    }));

    render(<MarkdownContent text="[q-77](quest:q-77)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "q-77" }));

    const card = await screen.findByTestId("quest-hover-card");
    const timeline = within(card).getByTestId("quest-journey-timeline");
    expect(within(card).getByTestId("quest-journey-preview-card")).toBeTruthy();
    expect(timeline.getAttribute("data-journey-mode")).toBe("completed");
    expect(within(card).getByText("Completed Journey")).toBeTruthy();
    expect(within(card).queryByText("Active Journey")).toBeNull();
    expect(within(card).queryByText("current")).toBeNull();
  });

  it("keeps external links as normal web links", () => {
    render(<MarkdownContent text="[docs](https://example.com)" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("gives external links a rectangular hit target when they wrap", () => {
    // Long autolinks can wrap across line boxes. The inline-block shell keeps
    // the clickable element's box rectangular so center clicks do not fall
    // through to the parent paragraph.
    render(<MarkdownContent text="[https://example.com/very/long/path](https://example.com/very/long/path)" />);

    const link = screen.getByRole("link", { name: "https://example.com/very/long/path" });
    expect(link.className).toContain("inline-block");
    expect(link.className).toContain("max-w-full");
    expect(link.className).toContain("align-baseline");
  });

  it("routes session: schema links to the referenced session hash", () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
    }));

    render(<MarkdownContent text="[#123](session:123)" />);

    const link = screen.getByRole("link", { name: "#123" });
    expect(link.getAttribute("href")).toBe("#/session/123");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/session/session-abc");
  });

  it("routes session:N:M message-level links with msg query param in href", () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
    }));

    render(<MarkdownContent text="[#123 msg 42](session:123:42)" />);

    const link = screen.getByRole("link", { name: "#123 msg 42" });
    // Href should include ?msg= query param for right-click "open in new tab" support
    expect(link.getAttribute("href")).toBe("#/session/123?msg=42");
    expect(link.getAttribute("title")).toBe("Open session #123, message 42");
  });

  it("shows the referenced message in a dedicated hover preview for session:N:M links", async () => {
    mockFetchMessagePreview.mockResolvedValue({
      id: "hover-session-abc-42",
      role: "assistant",
      content: "The actual **message** preview.",
      contentBlocks: [{ type: "text", text: "The actual **message** preview." }],
      timestamp: 1000,
    });

    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
      sessionPreviews: new Map([["session-abc", "stale sidebar preview"]]),
      sessionTaskHistory: new Map([
        [
          "session-abc",
          [
            {
              title: "This task chrome should stay out of the message preview",
              action: "new",
              timestamp: 1,
              triggerMessageId: "u1",
            },
          ],
        ],
      ]),
    }));

    render(<MarkdownContent text="[#123 msg 42](session:123:42)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123 msg 42" }));

    expect(await screen.findByTestId("message-link-hover-card")).toBeTruthy();
    expect(await screen.findByText("The actual", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Loading message…")).toBeNull();
    expect(screen.queryByText("Tasks")).toBeNull();
    expect(screen.queryByText("Last message")).toBeNull();
    expect(mockFetchMessagePreview).toHaveBeenCalledWith("session-abc", 42);
  });

  it("shows successful result message content in a dedicated hover preview for session:N:M links", async () => {
    // Guards the q-468 regression: message-link hovers must render successful
    // `result` history entries instead of falling back to "Message unavailable."
    mockFetchMessagePreview.mockResolvedValue({
      id: "hover-session-abc-337",
      role: "assistant",
      content: "All 4 datasets now active.",
      timestamp: 1000,
    });

    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Leader 12"]]),
    }));

    render(<MarkdownContent text="[#123 msg 337](session:123:337)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123 msg 337" }));

    expect(await screen.findByTestId("message-link-hover-card")).toBeTruthy();
    expect(await screen.findByText("All 4 datasets now active.", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Message unavailable.")).toBeNull();
    expect(mockFetchMessagePreview).toHaveBeenCalledWith("session-abc", 337);
  });

  it("renders non-assistant message-link previews with their chat variants intact", async () => {
    mockFetchMessagePreview.mockResolvedValue({
      id: "hover-session-abc-7",
      role: "system",
      content: "Approved Bash",
      timestamp: 1000,
      variant: "approved",
      metadata: {
        answers: [{ question: "Proceed?", answer: "Yes" }],
      },
    });

    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
    }));

    render(<MarkdownContent text="[#123 msg 7](session:123:7)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123 msg 7" }));

    expect(await screen.findByTestId("message-link-hover-card")).toBeTruthy();
    expect(screen.getByText("Proceed?")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("shows SessionHoverCard content when hovering a session link", async () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
    }));

    render(<MarkdownContent text="[#123](session:123)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123" }));

    expect(await screen.findByText("Auth Worker")).toBeTruthy();
  });

  it("keeps normal session links on the existing session hover behavior", async () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
      sessionPreviews: new Map([["session-abc", "Latest sidebar preview"]]),
      sessionTaskHistory: new Map([
        [
          "session-abc",
          [
            {
              title: "Keep existing session hover details",
              action: "new",
              timestamp: 1,
              triggerMessageId: "u1",
            },
          ],
        ],
      ]),
    }));

    render(<MarkdownContent text="[#123](session:123)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123" }));

    expect(await screen.findByText("Auth Worker")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Keep existing session hover details")).toBeTruthy();
    expect(screen.queryByTestId("message-link-hover-card")).toBeNull();
    expect(mockFetchMessagePreview).not.toHaveBeenCalled();
  });

  it("shows the active quest cross-link when hovering a session link", async () => {
    useStore.setState((state) => ({
      ...state,
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
      quests: [
        {
          id: "q-42-v1",
          questId: "q-42",
          version: 1,
          title: "Fix auth race condition",
          createdAt: 1,
          status: "in_progress",
          description: "Ensure claim state updates atomically.",
          sessionId: "session-abc",
          claimedAt: 1,
          tags: ["ui", "bugfix"],
        },
      ],
    }));

    render(<MarkdownContent text="[#123](session:123)" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123" }));

    expect(await screen.findByTestId("session-hover-active-quest")).toBeTruthy();
    expect(screen.getByRole("link", { name: "q-42" })).toBeTruthy();
    expect(screen.getByText("Fix auth race condition")).toBeTruthy();
  });

  it("omits quest and session cross-link rows when no owner or active quest exists", async () => {
    useStore.setState((state) => ({
      ...state,
      quests: [
        {
          id: "q-42-v1",
          questId: "q-42",
          version: 1,
          title: "Fix auth race condition",
          createdAt: 1,
          status: "refined",
          description: "Ensure claim state updates atomically.",
          tags: ["ui", "bugfix"],
        },
      ],
      sdkSessions: [
        {
          sessionId: "session-abc",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 123,
        },
      ],
      sessionNames: new Map([["session-abc", "Auth Worker"]]),
    }));

    render(
      <div>
        <MarkdownContent text="[q-42](quest:q-42)" />
        <MarkdownContent text="[#123](session:123)" />
      </div>,
    );

    fireEvent.mouseEnter(screen.getByRole("link", { name: "q-42" }));
    await screen.findByText("Fix auth race condition");
    expect(screen.queryByTestId("quest-hover-owner-session")).toBeNull();
    fireEvent.mouseLeave(screen.getByRole("link", { name: "q-42" }));

    fireEvent.mouseEnter(screen.getByRole("link", { name: "#123" }));
    await screen.findByText("Auth Worker");
    expect(screen.queryByTestId("session-hover-active-quest")).toBeNull();
  });

  it("opens file: links in VS Code using configured editor preference", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<MarkdownContent text="[app.ts](file:/tmp/project/app.ts:42)" />);
    fireEvent.click(screen.getByRole("link", { name: "app.ts" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith("vscode://file//tmp/project/app.ts:42:1", "_blank", "noopener,noreferrer");
    });
    openSpy.mockRestore();
  });

  it("can render local file links as inert text without changing the normal link surface", () => {
    const { rerender } = render(
      <MarkdownContent text="[app.ts](file:/tmp/project/app.ts:42)" fileLinkMode="text-only" />,
    );

    expect(screen.queryByRole("link", { name: "app.ts" })).toBeNull();
    expect(screen.getByText("app.ts").getAttribute("data-read-only-file-link")).toBe("true");
    expect(mockResolveFileLinkAction).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();

    rerender(<MarkdownContent text="[app.ts](file:/tmp/project/app.ts:42)" />);
    expect(screen.getByRole("link", { name: "app.ts" }).getAttribute("href")).toBe("file:/tmp/project/app.ts:42");
  });

  it("opens file: line-range links at the range start for local VS Code URIs", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<MarkdownContent text="[CLAUDE.md:53-54](file:/tmp/project/CLAUDE.md:53-54)" />);
    fireEvent.click(screen.getByRole("link", { name: "CLAUDE.md:53-54" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "vscode://file//tmp/project/CLAUDE.md:53:1",
        "_blank",
        "noopener,noreferrer",
      );
    });
    openSpy.mockRestore();
  });

  it("resolves repo-root-relative file: links against the active session repo root", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useStore.setState((state) => ({
      ...state,
      currentSessionId: "s1",
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            cwd: "/repo",
            repo_root: "/repo",
          } as never,
        ],
      ]),
    }));

    render(<MarkdownContent text="[TopBar.tsx](file:web/src/components/TopBar.tsx:162)" />);
    fireEvent.click(screen.getByRole("link", { name: "TopBar.tsx" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "vscode://file//repo/web/src/components/TopBar.tsx:162:1",
        "_blank",
        "noopener,noreferrer",
      );
    });
    openSpy.mockRestore();
  });

  it("resolves relative file: links against the worktree root for worktree sessions", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useStore.setState((state) => ({
      ...state,
      currentSessionId: "s1",
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            cwd: "/worktrees/repo-branch",
            repo_root: "/repo",
            is_worktree: true,
          } as never,
        ],
      ]),
    }));

    render(<MarkdownContent text="[TopBar.tsx](file:web/src/components/TopBar.tsx:162)" />);
    fireEvent.click(screen.getByRole("link", { name: "TopBar.tsx" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "vscode://file//worktrees/repo-branch/web/src/components/TopBar.tsx:162:1",
        "_blank",
        "noopener,noreferrer",
      );
    });
    openSpy.mockRestore();
  });

  it("remaps stale absolute worktree file links to the current worktree root", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    useStore.setState((state) => ({
      ...state,
      currentSessionId: "s1",
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            cwd: "/Users/yuege/.companion/worktrees/openai/master-wt-9326",
            repo_root: "/Users/yuege/code/openai",
            is_worktree: true,
          } as never,
        ],
      ]),
    }));

    render(
      <MarkdownContent text="[datasets.py](file:/Users/yuege/.companion/worktrees/openai/master-wt-7257/project/vs2s/audio_perception_asr/audio_perception_asr/datasets.py:1:1)" />,
    );
    fireEvent.click(screen.getByRole("link", { name: "datasets.py" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "vscode://file//Users/yuege/code/openai/project/vs2s/audio_perception_asr/audio_perception_asr/datasets.py:1:1",
        "_blank",
        "noopener,noreferrer",
      );
    });
    openSpy.mockRestore();
  });

  it("does not launch an editor for file: links when editor preference is none", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "none" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<MarkdownContent text="[app.ts](file:/tmp/project/app.ts:7:3)" />);
    fireEvent.click(screen.getByRole("link", { name: "app.ts" }));

    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalledTimes(1);
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("routes file links through the authoritative remote VSCode path when configured", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-1" });

    render(<MarkdownContent text="[app.ts](file:/tmp/project/app.ts:7:3)" />);
    fireEvent.click(screen.getByRole("link", { name: "app.ts" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/tmp/project/app.ts",
        line: 7,
        column: 3,
      });
    });
  });

  it("routes file line ranges through the authoritative remote VSCode path", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-range" });

    render(<MarkdownContent text="[CLAUDE.md:53-54](file:/tmp/project/CLAUDE.md:53-54)" />);
    fireEvent.click(screen.getByRole("link", { name: "CLAUDE.md:53-54" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/tmp/project/CLAUDE.md",
        line: 53,
        column: 1,
        endLine: 54,
      });
    });
  });

  it("routes repo-root-relative file links through the authoritative remote VSCode path", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-2" });

    setRepoSession();

    render(<MarkdownContent text="[TopBar.tsx](file:web/src/components/TopBar.tsx:162:4)" />);
    fireEvent.click(screen.getByRole("link", { name: "TopBar.tsx" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/TopBar.tsx",
        line: 162,
        column: 4,
      });
    });
  });

  it("routes worktree file links through the authoritative remote VSCode path using the worktree root", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-worktree" });

    setRepoSession({ isWorktree: true });

    render(<MarkdownContent text="[TopBar.tsx](file:web/src/components/TopBar.tsx:162:4)" />);
    fireEvent.click(screen.getByRole("link", { name: "TopBar.tsx" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/worktrees/repo-branch/web/src/components/TopBar.tsx",
        line: 162,
        column: 4,
      });
    });
  });

  it("routes stale absolute worktree links through remote VSCode using the current worktree root", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-stale-worktree" });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    useStore.setState((state) => ({
      ...state,
      currentSessionId: "s1",
      sessions: new Map([
        [
          "s1",
          {
            session_id: "s1",
            cwd: "/Users/yuege/.companion/worktrees/openai/master-wt-9326",
            repo_root: "/Users/yuege/code/openai",
            is_worktree: true,
          } as never,
        ],
      ]),
    }));

    render(
      <MarkdownContent text="[datasets.py](file:/Users/yuege/.companion/worktrees/openai/master-wt-7257/project/vs2s/audio_perception_asr/audio_perception_asr/datasets.py:1:1)" />,
    );
    fireEvent.click(screen.getByRole("link", { name: "datasets.py" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/Users/yuege/code/openai/project/vs2s/audio_perception_asr/audio_perception_asr/datasets.py",
        line: 1,
        column: 1,
      });
    });
  });

  it("opens standard Markdown repo file links through the file-link path", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-standard" });
    setRepoSession();

    render(<MarkdownContent text="[Panel](web/src/components/QuestDetailPanel.tsx)" />);
    fireEvent.click(screen.getByRole("link", { name: "Panel" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/QuestDetailPanel.tsx",
        line: 1,
        column: 1,
      });
    });
  });

  it("opens image file links in Takode preview on left click instead of the editor", async () => {
    // Left-click should now use the same file-link preview behavior that was
    // previously only reachable from the context menu for supported images.
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/artifacts/preview.png",
      requestedPath: "artifacts/preview.png",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: true,
      mimeType: "image/png",
      canRevealInFinder: true,
      platform: "darwin",
    });
    setRepoSession();

    render(<MarkdownContent text="[preview](file:artifacts/preview.png)" />);
    fireEvent.click(screen.getByRole("link", { name: "preview" }));

    const image = await screen.findByTestId("lightbox-image");
    expect(image.getAttribute("src")).toContain("/api/fs/file-link/preview?");
    expect(image.getAttribute("src")).toContain("path=artifacts%2Fpreview.png");
    expect(image.getAttribute("src")).toContain("sessionId=s1");
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockOpenVsCodeRemoteFile).not.toHaveBeenCalled();
  });

  it("opens explicit and standard HTML file links through native same-browser new-tab navigation", () => {
    // A real target=_blank anchor preserves browser popup, modifier, and keyboard semantics
    // without an async window.open call that can be blocked or duplicated.
    setRepoSession();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <div>
        <MarkdownContent text="[relative HTML](file:web/src/demo/index.html)" />
        <MarkdownContent text="[uppercase HTML](file:/tmp/report.HTML)" />
        <MarkdownContent text="[standard HTML](web/docs/tutorial.html)" />
      </div>,
    );

    const relativeLink = screen.getByRole("link", { name: "relative HTML" });
    const uppercaseLink = screen.getByRole("link", { name: "uppercase HTML" });
    const standardLink = screen.getByRole("link", { name: "standard HTML" });
    for (const link of [relativeLink, uppercaseLink, standardLink]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("href")).toMatch(/^\/file-preview\/open\?/);
    }

    const relativeUrl = new URL(relativeLink.getAttribute("href")!, "http://localhost");
    expect(relativeUrl.searchParams.get("path")).toBe("web/src/demo/index.html");
    expect(relativeUrl.searchParams.get("isRelative")).toBe("1");
    expect(relativeUrl.searchParams.get("sessionId")).toBe("s1");
    const uppercaseUrl = new URL(uppercaseLink.getAttribute("href")!, "http://localhost");
    expect(uppercaseUrl.searchParams.get("path")).toBe("/tmp/report.HTML");
    expect(uppercaseUrl.searchParams.get("isRelative")).toBe("0");

    let preventedBeforeNavigationGuard: boolean | undefined;
    document.addEventListener(
      "click",
      (event) => {
        preventedBeforeNavigationGuard = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    relativeLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(preventedBeforeNavigationGuard).toBe(false);
    expect(mockResolveFileLinkAction).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockOpenVsCodeRemoteFile).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("preserves native modifier, keyboard-generated, and auxiliary activation without duplicate HTML opens", () => {
    // Browser-native activation owns exactly one navigation. React only observes the
    // event and never adds a second window.open or editor action.
    setRepoSession();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MarkdownContent text="[tutorial](file:web/docs/tutorial.html)" />);
    const link = screen.getByRole("link", { name: "tutorial" });

    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { detail: 0 },
    ] satisfies MouseEventInit[]) {
      let preventedBeforeNavigationGuard: boolean | undefined;
      document.addEventListener(
        "click",
        (event) => {
          preventedBeforeNavigationGuard = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
      expect(preventedBeforeNavigationGuard).toBe(false);
    }

    let auxiliaryPrevented: boolean | undefined;
    document.addEventListener(
      "auxclick",
      (event) => {
        auxiliaryPrevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(auxiliaryPrevented).toBe(false);

    expect(mockResolveFileLinkAction).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockOpenVsCodeRemoteFile).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("keeps HTML-like non-HTML suffixes on the editor path", async () => {
    // The browser default applies only to a final case-insensitive .html extension.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-html-text" });
    setRepoSession();

    render(<MarkdownContent text="[source](file:web/docs/tutorial.html.txt)" />);
    const link = screen.getByRole("link", { name: "source" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("href")).toBe("file:web/docs/tutorial.html.txt:1");
    fireEvent.click(link);

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/docs/tutorial.html.txt",
        line: 1,
        column: 1,
      });
    });
  });

  it("retains explicit context-menu editor access for HTML links", async () => {
    // HTML changes the ordinary click default only; the established authoritative
    // resolver and editor action remain available from the shared file menu.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-html-editor" });
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/web/docs/tutorial.html",
      requestedPath: "web/docs/tutorial.html",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: false,
      canRevealInFinder: true,
      canOpenContainingFolder: true,
      openContainingFolderLabel: "Open in Finder",
      platform: "darwin",
    });
    setRepoSession();

    render(<MarkdownContent text="[tutorial](file:web/docs/tutorial.html)" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "tutorial" }), { clientX: 24, clientY: 40 });

    expect(await screen.findByText("Open in Editor")).toBeTruthy();
    expect(screen.getByText("Copy File Path")).toBeTruthy();
    expect(await screen.findByText("Open in Finder")).toBeTruthy();
    fireEvent.click(screen.getByText("Open in Editor"));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/docs/tutorial.html",
        line: 1,
        column: 1,
      });
    });
  });

  it("suppresses the one native HTML navigation after a mobile long press", () => {
    // Mobile browsers synthesize a click after long-press. The existing guard must
    // continue cancelling that click now that HTML uses a native target=_blank link.
    vi.useFakeTimers();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      setRepoSession();
      render(<MarkdownContent text="[mobile tutorial](file:web/docs/tutorial.html)" />);
      const link = screen.getByRole("link", { name: "mobile tutorial" });

      fireEvent.touchStart(link, { touches: [{ clientX: 32, clientY: 48 }] });
      act(() => {
        vi.advanceTimersByTime(550);
      });

      expect(screen.getByText("Open in Editor")).toBeTruthy();
      const followUpClick = new MouseEvent("click", { bubbles: true, cancelable: true });
      expect(link.dispatchEvent(followUpClick)).toBe(false);
      expect(followUpClick.defaultPrevented).toBe(true);
      expect(mockGetSettings).not.toHaveBeenCalled();
      expect(mockOpenVsCodeRemoteFile).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("allows the next genuine HTML tap when a long press produces no synthetic click", () => {
    // Some mobile browsers cancel the long-press sequence without emitting the
    // click that normally clears suppression. A later touchstart must scope the
    // guard to the old gesture so the new tap can navigate natively.
    vi.useFakeTimers();
    try {
      setRepoSession();
      render(<MarkdownContent text="[mobile tutorial](file:web/docs/tutorial.html)" />);
      const link = screen.getByRole("link", { name: "mobile tutorial" });

      fireEvent.touchStart(link, { touches: [{ clientX: 32, clientY: 48 }] });
      act(() => {
        vi.advanceTimersByTime(550);
      });
      expect(screen.getByText("Open in Editor")).toBeTruthy();
      fireEvent.touchCancel(link);

      fireEvent.touchStart(link, { touches: [{ clientX: 32, clientY: 48 }] });
      fireEvent.touchEnd(link);
      let preventedBeforeNavigationGuard: boolean | undefined;
      document.addEventListener(
        "click",
        (event) => {
          preventedBeforeNavigationGuard = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      expect(preventedBeforeNavigationGuard).toBe(false);
      expect(mockGetSettings).not.toHaveBeenCalled();
      expect(mockOpenVsCodeRemoteFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps non-image file-link left clicks on the editor-open path", async () => {
    // Non-image links must preserve the established default even though click
    // handling now asks the backend whether a target is previewable.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-non-image" });
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/web/src/app.ts",
      requestedPath: "web/src/app.ts",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: false,
      canRevealInFinder: false,
      platform: "linux",
    });
    setRepoSession();

    render(<MarkdownContent text="[app](file:web/src/app.ts)" />);
    fireEvent.click(screen.getByRole("link", { name: "app" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/app.ts",
        line: 1,
        column: 1,
      });
    });
    expect(screen.queryByTestId("lightbox-image")).toBeNull();
  });

  it("falls back to the editor-open path when file-link preview detection fails", async () => {
    // Backend resolution is used to detect supported images, but a transient
    // resolve failure should not strand normal file-link clicks.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-fallback" });
    mockResolveFileLinkAction.mockRejectedValue(new Error("resolve unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setRepoSession();

    try {
      render(<MarkdownContent text="[app](file:web/src/app.ts)" />);
      fireEvent.click(screen.getByRole("link", { name: "app" }));

      await waitFor(() => {
        expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
          absolutePath: "/repo/web/src/app.ts",
          line: 1,
          column: 1,
        });
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("parses GitHub-style line fragments on standard Markdown repo file links", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-fragment" });
    setRepoSession();

    render(<MarkdownContent text="[Panel](web/src/components/QuestDetailPanel.tsx#L42-L57)" />);
    fireEvent.click(screen.getByRole("link", { name: "Panel" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/QuestDetailPanel.tsx",
        line: 42,
        column: 1,
        endLine: 57,
      });
    });
  });

  it("parses suffix line, column, and range metadata on standard Markdown repo file links", async () => {
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "window-a", commandId: "cmd-suffix" });
    setRepoSession();

    render(
      <MarkdownContent
        text={
          "[Line](web/src/components/QuestDetailPanel.tsx:42) [Column](web/src/components/QuestDetailPanel.tsx:42:7) [Range](web/src/components/QuestDetailPanel.tsx:42-57)"
        }
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Line" }));
    fireEvent.click(screen.getByRole("link", { name: "Column" }));
    fireEvent.click(screen.getByRole("link", { name: "Range" }));

    await waitFor(() => {
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/QuestDetailPanel.tsx",
        line: 42,
        column: 1,
      });
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/QuestDetailPanel.tsx",
        line: 42,
        column: 7,
      });
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/repo/web/src/components/QuestDetailPanel.tsx",
        line: 42,
        column: 1,
        endLine: 57,
      });
    });
  });

  it("preserves normal external and unsafe standard Markdown links as non-file links", () => {
    mockGetSettings.mockClear();

    render(
      <div>
        <MarkdownContent text="[external](https://example.com/file.ts)" />
        <MarkdownContent text="[unsafe](../outside.ts)" />
      </div>,
    );

    fireEvent.click(screen.getByRole("link", { name: "external" }));
    fireEvent.click(screen.getByRole("link", { name: "unsafe" }));

    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "external" }).getAttribute("href")).toBe("https://example.com/file.ts");
    expect(screen.getByRole("link", { name: "unsafe" }).getAttribute("href")).toBe("../outside.ts");
  });

  it("opens a backend-resolved context menu for image file links", async () => {
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/artifacts/preview.png",
      requestedPath: "artifacts/preview.png",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: true,
      mimeType: "image/png",
      canRevealInFinder: true,
      platform: "darwin",
    });
    setRepoSession();

    render(<MarkdownContent text="[preview](file:artifacts/preview.png)" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "preview" }), { clientX: 24, clientY: 40 });

    expect(await screen.findByText("Open in Editor")).toBeTruthy();
    expect(screen.getByText("Copy File Path")).toBeTruthy();
    expect(await screen.findByText("Open in Finder")).toBeTruthy();
    fireEvent.click(screen.getByText("Preview in Takode"));

    const image = await screen.findByTestId("lightbox-image");
    expect(image.getAttribute("src")).toContain("/api/fs/file-link/preview?");
    expect(image.getAttribute("src")).toContain("path=artifacts%2Fpreview.png");
    expect(image.getAttribute("src")).toContain("sessionId=s1");
  });

  it("copies the backend-resolved absolute file path from the context menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboardNavigator = { ...window.navigator, clipboard: { writeText } };
    Object.defineProperty(window, "navigator", {
      value: clipboardNavigator,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: clipboardNavigator,
      configurable: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/web/src/app.ts",
      requestedPath: "web/src/app.ts",
      exists: true,
      isFile: true,
      isDirectory: false,
      isImage: false,
      canRevealInFinder: false,
      platform: "linux",
    });
    setRepoSession();

    render(<MarkdownContent text="[app](file:web/src/app.ts)" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "app" }), { clientX: 10, clientY: 12 });
    fireEvent.click(await screen.findByText("Copy File Path"));

    await waitFor(() => {
      expect(mockResolveFileLinkAction).toHaveBeenCalled();
      if (alertSpy.mock.calls.length) {
        throw new Error(String(alertSpy.mock.calls[0]?.[0]));
      }
      expect(writeText).toHaveBeenCalledWith("/repo/web/src/app.ts");
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    expect(screen.queryByText("Open in Finder")).toBeNull();
    expect(screen.queryByText("Preview in Takode")).toBeNull();
  });

  it("copies a backend-resolved path even when the file is missing", async () => {
    // Missing targets should still expose the absolute path because copy is a
    // path action, not a file-open action.
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboardNavigator = { ...window.navigator, clipboard: { writeText } };
    Object.defineProperty(window, "navigator", {
      value: clipboardNavigator,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: clipboardNavigator,
      configurable: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockResolveFileLinkAction.mockResolvedValue({
      absolutePath: "/repo/missing.ts",
      requestedPath: "missing.ts",
      exists: false,
      isFile: false,
      isDirectory: false,
      isImage: false,
      canRevealInFinder: false,
      platform: "linux",
    });
    setRepoSession();

    render(<MarkdownContent text="[missing](file:missing.ts)" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "missing" }), { clientX: 10, clientY: 12 });
    await screen.findByText("File unavailable");
    fireEvent.click(await screen.findByText("Copy File Path"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/repo/missing.ts");
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("opens the file-link menu from a mobile long press without launching the editor", async () => {
    vi.useFakeTimers();
    try {
      setRepoSession();
      render(<MarkdownContent text="[mobile](file:web/src/mobile.ts)" />);

      fireEvent.touchStart(screen.getByRole("link", { name: "mobile" }), {
        touches: [{ clientX: 32, clientY: 48 }],
      });
      act(() => {
        vi.advanceTimersByTime(550);
      });

      expect(screen.getByText("Open in Editor")).toBeTruthy();
      fireEvent.click(screen.getByRole("link", { name: "mobile" }));
      expect(mockGetSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the remote VSCode error when the server reports no running VSCode window", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-remote" } });
    mockOpenVsCodeRemoteFile.mockRejectedValue(new Error("No running VSCode was detected on this machine."));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<MarkdownContent text="[app.ts](file:/tmp/project/app.ts:7:3)" />);
    fireEvent.click(screen.getByRole("link", { name: "app.ts" }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("No running VSCode was detected on this machine.");
    });
    alertSpy.mockRestore();
  });
});
