// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Profiler } from "react";
import { useStore } from "../store.js";
import type { ChatMessage, SdkSessionInfo } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";

// Feed rows subscribe to the session list and the message store. The session list changes
// whenever any session reports activity (often about once a second per busy session), and
// the message store changes with every incoming message. Before these tests, every message
// menu, session link and user bubble re-rendered on each of those changes. These tests pin
// that a row re-renders only for changes to what it shows, and still shows its own changes.

const VIEWED = "viewed-session";
const LINKED = "linked-session";
const OTHER = "other-session";

function row(sessionId: string, sessionNum: number, name: string): SdkSessionInfo {
  return { sessionId, sessionNum, name, state: "connected", cwd: "/repo", createdAt: 1 } as SdkSessionInfo;
}

const assistant: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "Worker [#12](session:12) changed [app.ts](file:src/app.ts).",
  contentBlocks: [{ type: "text", text: "Worker [#12](session:12) changed [app.ts](file:src/app.ts)." }],
  timestamp: 2,
};
const user: ChatMessage = { id: "user-1", role: "user", content: "Please check the worker.", timestamp: 1 };

/** Replace one row the way the session-navigation projection does: a new array, other rows kept as-is. */
function updateRow(sessionId: string, patch: Partial<SdkSessionInfo>) {
  act(() => {
    useStore.setState((state) => ({
      sdkSessions: state.sdkSessions.map((session) =>
        session.sessionId === sessionId ? { ...session, ...patch } : session,
      ),
    }));
  });
}

function renderRows() {
  const commits: Record<string, number> = { assistant: 0, user: 0 };
  const onRender = (id: string) => {
    commits[id] = (commits[id] ?? 0) + 1;
  };
  const view = render(
    <>
      <Profiler id="assistant" onRender={onRender}>
        <MessageBubble message={assistant} sessionId={VIEWED} />
      </Profiler>
      <Profiler id="user" onRender={onRender}>
        <MessageBubble message={user} sessionId={VIEWED} />
      </Profiler>
    </>,
  );
  const reset = () => {
    commits.assistant = 0;
    commits.user = 0;
  };
  reset();
  return { view, commits, reset };
}

beforeEach(() => {
  useStore.getState().reset();
  useStore.setState({
    sdkSessions: [row(VIEWED, 10, "Leader"), row(LINKED, 12, "Worker"), row(OTHER, 13, "Unrelated")],
    messages: new Map([[VIEWED, [user, assistant]]]),
  });
});

describe("feed row render isolation", () => {
  it("does not re-render message rows when an unrelated session updates", () => {
    const { commits } = renderRows();

    updateRow(OTHER, { name: "Renamed elsewhere", lastActivityAt: 99 });

    expect(commits).toEqual({ assistant: 0, user: 0 });
  });

  it("does not re-render user bubbles when another message arrives", () => {
    const { commits } = renderRows();
    const reply: ChatMessage = { id: "assistant-2", role: "assistant", content: "Done.", timestamp: 3 };

    act(() => {
      useStore.setState((state) => ({ messages: new Map([[VIEWED, [...state.messages.get(VIEWED)!, reply]]]) }));
    });

    expect(commits.user).toBe(0);
  });

  it("still shows a change to the linked session itself", () => {
    const { view, commits } = renderRows();
    const link = () => view.container.querySelector('a[href*="12"]') ?? view.getByText("#12").closest("a")!;
    expect(link()).toHaveAttribute("title", "Open session #12");

    // The linked session leaves the list: its link must turn into a not-found link.
    act(() => {
      useStore.setState((state) => ({
        sdkSessions: state.sdkSessions.filter((session) => session.sessionId !== LINKED),
      }));
    });

    expect(commits.assistant).toBeGreaterThan(0);
    expect(view.getByText("#12").closest("a")).toHaveAttribute("title", "#12 not found");
  });
});

describe("quest quiz render isolation", () => {
  it("re-renders an assistant message only for its own quiz quest", () => {
    const quizMessage: ChatMessage = {
      id: "assistant-quiz",
      role: "assistant",
      content: "Done.\n\n{[(Quest Quiz: q-7)]}",
      contentBlocks: [{ type: "text", text: "Done.\n\n{[(Quest Quiz: q-7)]}" }],
      timestamp: 4,
    };
    const quest = (questId: string, quizItems: Array<{ question: string; answer: string }>) =>
      ({ id: `${questId}-v1`, questId, version: 1, status: "done", title: questId, createdAt: 1, quizItems }) as never;
    let commits = 0;
    const view = render(
      <Profiler id="quiz" onRender={() => commits++}>
        <MessageBubble message={quizMessage} sessionId={VIEWED} />
      </Profiler>,
    );
    commits = 0;

    // Another quest's update must not re-render this message.
    act(() => useStore.getState().upsertQuestDetail(quest("q-8", [{ question: "Other?", answer: "No." }])));
    expect(commits).toBe(0);

    // Its own quest's quiz still appears.
    act(() => useStore.getState().upsertQuestDetail(quest("q-7", [{ question: "Why?", answer: "Because." }])));
    expect(commits).toBeGreaterThan(0);
    expect(view.getByText("Why?")).toBeInTheDocument();
  });
});
