// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ChatMessage, SessionState, ToolResultPreview } from "../types.js";
import { groupMessages } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import { FeedEntries } from "./MessageFeedEntries.js";

const ownership = { childId: "opaque-child", rootTurnId: "root-turn" };

function toolMessage(
  id: string,
  command: string,
  result: ToolResultPreview | undefined,
  childOwned: boolean,
  withText = false,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: withText ? `${command} explanation` : "",
    contentBlocks: [
      ...(withText ? ([{ type: "text", text: `${command} explanation` }] as const) : []),
      { type: "tool_use", id: "shared-tool", name: "Bash", input: { command } },
    ],
    timestamp: childOwned ? 2 : 3,
    ...(childOwned ? { parentToolUseId: "spawn-tool" } : {}),
    ...(childOwned
      ? {
          metadata: {
            codexSubagent: ownership,
            ...(result ? { codexSubagentToolResults: { "shared-tool": result } } : {}),
          },
        }
      : {}),
  };
}

function installSession(rootResult: ToolResultPreview) {
  useStore.getState().reset();
  useStore.setState({
    sessions: new Map([
      ["session-1", { session_id: "session-1", backend_type: "codex", cwd: "/repo" } as SessionState],
    ]),
    toolResults: new Map([["session-1", new Map([["shared-tool", rootResult]])]]),
    toolProgress: new Map([
      ["session-1", new Map([["shared-tool", { toolName: "Bash", elapsedSeconds: 99, output: "root live" }]])],
    ]),
    toolStartTimestamps: new Map([["session-1", new Map([["shared-tool", 1]])]]),
    compactToolActivity: false,
  });
}

function renderEntries(messages: ChatMessage[]) {
  return render(
    <FeedEntries
      entries={groupMessages(messages)}
      sessionId="session-1"
      isCodexSession
      activeCodexTerminalIds={new Set(["shared-tool"])}
      onOpenCodexTerminal={() => {}}
    />,
  );
}

describe("canonical native Codex child rendering", () => {
  const rootResult: ToolResultPreview = {
    tool_use_id: "shared-tool",
    content: "ROOT RESULT COLLISION",
    is_error: true,
    total_size: 21,
    is_truncated: false,
    duration_seconds: 99,
  };
  const childResult: ToolResultPreview = {
    tool_use_id: "shared-tool",
    content: "child-owned result",
    is_error: false,
    total_size: 18,
    is_truncated: false,
  };

  beforeEach(() => installSession(rootResult));
  afterEach(() => useStore.getState().reset());

  it("keeps child-owned tool-only overrides isolated when the inspector reuses feed renderers", () => {
    const view = renderEntries([
      toolMessage("child-tool", "child command", childResult, true),
      toolMessage("root-tool", "root command", undefined, false),
    ]);

    const childHeader = screen.getByText("child command").closest('[role="button"]') as HTMLElement;
    const rootHeader = screen.getByText("root command").closest('[role="button"]') as HTMLElement;
    expect(childHeader).not.toBe(rootHeader);
    fireEvent.click(childHeader);

    expect(within(childHeader.parentElement!).getByText("child-owned result")).toBeInTheDocument();
    expect(within(childHeader.parentElement!).queryByText("ROOT RESULT COLLISION")).toBeNull();
    expect(childHeader).not.toHaveTextContent("99");
    expect(view.container.querySelector('[data-testid="live-codex-terminal-stub"]')).toBeNull();
  });

  it("uses message-local child overrides for mixed text-and-tool inspector rows", () => {
    renderEntries([toolMessage("child-mixed", "mixed child", childResult, true, true)]);

    const header = screen.getByText("mixed child").closest('[role="button"]') as HTMLElement;
    fireEvent.click(header);
    expect(screen.getByText("child-owned result")).toBeInTheDocument();
    expect(screen.queryByText("ROOT RESULT COLLISION")).toBeNull();
  });

  it("renders stable child errors through the inspector's canonical error surface", () => {
    renderEntries([
      {
        id: "child-error",
        role: "system",
        content: "Privacy-bounded child failure",
        timestamp: 4,
        variant: "error",
        metadata: { codexSubagent: ownership },
      },
    ]);

    expect(screen.getByText("Privacy-bounded child failure")).toHaveClass("text-cc-error");
  });
});
