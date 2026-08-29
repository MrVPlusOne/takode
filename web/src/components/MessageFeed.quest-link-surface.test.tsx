// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { MessageFeed } from "./MessageFeed.js";
import { CodexSubagentTranscript } from "./CodexSubagentTranscript.js";

const SESSION_ID = "feed-quest-preview-session";

function messages(): ChatMessage[] {
  return [
    {
      id: "feed-user",
      role: "user",
      content: "User [q-80](quest:q-80)",
      timestamp: 1,
    },
    {
      id: "feed-assistant",
      role: "assistant",
      content: "Assistant [q-81 feedback #2](quest:q-81:feedback:2)",
      contentBlocks: [{ type: "text", text: "Assistant [q-81 feedback #2](quest:q-81:feedback:2)" }],
      timestamp: 2,
    },
  ];
}

describe("MessageFeed quest-link surface wiring", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState((state) => ({
      ...state,
      messages: new Map([[SESSION_ID, messages()]]),
      sessions: new Map([
        [
          SESSION_ID,
          {
            session_id: SESSION_ID,
            backend_type: "claude",
            cwd: "/tmp/project",
          } as never,
        ],
      ]),
      sdkSessions: [
        {
          sessionId: SESSION_ID,
          state: "connected",
          cwd: "/tmp/project",
          createdAt: 1,
          sessionNum: 80,
          backendType: "claude",
        },
      ],
    }));
    Element.prototype.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opts real MessageFeed user and assistant payloads into chat-feed previews", () => {
    render(<MessageFeed sessionId={SESSION_ID} />);

    expect(screen.getByRole("button", { name: "Preview q-80" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview q-81 feedback #2" })).toBeInTheDocument();
  });

  it("threads the feed surface into pending user rows and committed Codex streaming Markdown", () => {
    const session = useStore.getState().sessions.get(SESSION_ID)!;
    const sdkSession = useStore.getState().sdkSessions[0]!;
    useStore.setState({
      sessions: new Map([[SESSION_ID, { ...session, backend_type: "codex" }]]),
      sdkSessions: [{ ...sdkSession, backendType: "codex" }],
      pendingUserUploads: new Map([
        [
          SESSION_ID,
          [
            {
              id: "pending-preview",
              content: "Pending [q-82](quest:q-82)",
              images: [],
              timestamp: 3,
              stage: "delivering",
            },
          ],
        ],
      ]),
      streaming: new Map([[SESSION_ID, "Streaming [q-83 feedback #4](quest:q-83:feedback:4)\n"]]),
    });

    render(<MessageFeed sessionId={SESSION_ID} />);

    expect(screen.getByRole("button", { name: "Preview q-82" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview q-83 feedback #4" })).toBeInTheDocument();
  });

  it("keeps the reused read-only Codex transcript producer on legacy links", () => {
    render(<CodexSubagentTranscript sessionId={SESSION_ID} messages={messages()} />);

    expect(screen.queryByRole("button", { name: /Preview q-/ })).toBeNull();
    expect(screen.getByRole("link", { name: "q-80" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-81 feedback #2" })).toBeInTheDocument();
  });
});
