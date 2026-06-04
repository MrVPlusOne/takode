// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ChatMessage, SlackThreadRecord } from "../types.js";

const sendSlackThreadMessageMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const connectSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    sendSlackThreadMessage: sendSlackThreadMessageMock,
  },
}));

vi.mock("../ws.js", () => ({
  connectSession: connectSessionMock,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { useStore } from "../store.js";
import { SlackThreadPanel } from "./SlackThreadPanel.js";

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "thread-assistant",
    role: "assistant",
    content: "Thread answer",
    timestamp: 100,
    ...overrides,
  };
}

function makeThread(overrides: Partial<SlackThreadRecord> = {}): SlackThreadRecord {
  return {
    id: "st-1",
    rootSessionId: "root",
    childSessionId: "hidden-child",
    anchorMessageId: "root-assistant",
    anchorHistoryIndex: 1,
    anchorPreview: "Root answer",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    seeded: true,
    ...overrides,
  };
}

describe("SlackThreadPanel", () => {
  beforeEach(() => {
    useStore.getState().reset();
    sendSlackThreadMessageMock.mockClear();
    connectSessionMock.mockClear();
  });

  it("renders in-thread assistant messages without nested thread creation affordances", () => {
    useStore.setState({
      messages: new Map([["hidden-child", [makeAssistantMessage()]]]),
    });

    render(<SlackThreadPanel rootSessionId="root" thread={makeThread()} onClose={() => {}} />);

    expect(screen.getByText("Thread answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open thread with/i })).toBeNull();
  });

  it("explains that Slack thread replies are read-only and must not edit files", () => {
    render(<SlackThreadPanel rootSessionId="root" thread={makeThread()} onClose={() => {}} />);

    expect(screen.getByText(/Use this thread for analysis and follow-up questions only/i)).toBeTruthy();
    expect(screen.getByText(/File and repo edits are blocked here/i)).toBeTruthy();
  });
});
