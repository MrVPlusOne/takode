// @vitest-environment jsdom
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import type { ChatMessage, SideChatRecord } from "../types.js";

const sendSideChatMessageMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const connectSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    sendSideChatMessage: sendSideChatMessageMock,
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
import { SideChatPanel } from "./SideChatPanel.js";

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "thread-assistant",
    role: "assistant",
    content: "Side Chat answer",
    timestamp: 100,
    ...overrides,
  };
}

function makeSideChat(overrides: Partial<SideChatRecord> = {}): SideChatRecord {
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

describe("SideChatPanel", () => {
  beforeEach(() => {
    useStore.getState().reset();
    sendSideChatMessageMock.mockClear();
    connectSessionMock.mockClear();
  });

  it("renders Side Chat assistant messages without nested Side Chat creation affordances", () => {
    useStore.setState({
      messages: new Map([["hidden-child", [makeAssistantMessage()]]]),
    });

    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText("Side Chat answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Side Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Side Chat with/i })).toBeNull();
  });

  it("explains that Side Chat replies are read-only and must not edit files", () => {
    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat()} onClose={() => {}} />);

    expect(screen.getByText(/Use this workspace for analysis and follow-up questions only/i)).toBeTruthy();
    expect(screen.getByText(/File and repo edits are blocked here/i)).toBeTruthy();
  });

  it("shows bounded replay provenance and fallback reason", () => {
    render(
      <SideChatPanel
        rootSessionId="root"
        sideChat={makeSideChat({
          contextStrategy: "bounded-replay",
          contextFallbackReason: "Codex native fork skipped: anchor turn is not complete",
        })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Bounded replay")).toBeTruthy();
    expect(screen.getByText(/Native fork was unavailable/i)).toBeTruthy();
    expect(screen.getByText(/anchor turn is not complete/i)).toBeTruthy();
  });

  it("does not infer native provenance for legacy Side Chat records", () => {
    render(<SideChatPanel rootSessionId="root" sideChat={makeSideChat({ seeded: true })} onClose={() => {}} />);

    expect(screen.getByText("Legacy status unknown")).toBeTruthy();
    expect(screen.getByText(/Context provenance is unknown/i)).toBeTruthy();
    expect(screen.queryByText("Native fork")).toBeNull();
  });
});
