// @vitest-environment jsdom
/**
 * A thread the Scribe joined onto the conversation it continues: the feed marks where its messages
 * begin in the earlier conversation, naming that conversation, with Undo. And a thread's strip
 * carries its topic as a tag that opens the topic's page.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const unjoinThread = vi.hoisted(() => vi.fn());
vi.mock("../api/topics.js", () => ({ topicApi: { unjoinThread, threads: vi.fn(() => new Promise(() => {})) } }));
import type { ChatMessage } from "../types.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { rememberThreads } from "../utils/leader-topics.js";
import { joinedThreadStarts } from "./MessageFeedTurns.js";
import { JoinedThreadMarker } from "./ThreadJoinMarker.js";
import { ThreadStrip } from "./ThreadStrip.js";

afterEach(() => {
  cleanup();
  unjoinThread.mockReset();
  rememberThreads("l1", []);
});

function turn(id: string, threadRefs?: NonNullable<ChatMessage["metadata"]>["threadRefs"]): Turn {
  const msg: ChatMessage = { id, role: "user", content: id, timestamp: 1, metadata: threadRefs ? { threadRefs } : {} };
  return { id, userEntry: { kind: "message", msg }, allEntries: [] } as unknown as Turn;
}

describe("joinedThreadStarts", () => {
  it("marks the first turn of each thread joined onto the one on screen", () => {
    const joined = (from: string, threadKey = "topic:aa11") => [
      { threadKey, source: "backfill" as const, joinedFrom: from },
    ];
    const turns = [
      turn("t1"),
      turn("t2", joined("topic:bb22")),
      turn("t3", joined("topic:bb22")),
      // Joined onto another conversation: not this one's.
      turn("t4", joined("topic:cc33", "q-9")),
      turn("t5", joined("topic:dd44")),
    ];
    expect(joinedThreadStarts(turns, "topic:aa11")).toEqual(
      new Map([
        ["t2", "topic:bb22"],
        ["t5", "topic:dd44"],
      ]),
    );
    expect(joinedThreadStarts([turn("t1")], "topic:aa11")).toBeNull();
  });
});

describe("JoinedThreadMarker", () => {
  it("names the earlier conversation and undoes the join", async () => {
    rememberThreads("l1", [
      { id: "aa11", key: "topic:aa11", name: "Composer sits low", leaderId: "l1", createdAt: 1, activityAt: 1 },
    ]);
    unjoinThread.mockResolvedValue({ thread: {} });
    render(<JoinedThreadMarker sessionId="l1" threadKey="topic:aa11" joinedFrom="topic:bb22" />);
    const marker = screen.getByTestId("thread-join-marker");
    expect(marker.textContent).toContain("Continues “Composer sits low” · joined by the Scribe");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(unjoinThread).toHaveBeenCalledWith("l1", "topic:bb22");
    // One undo at a time: the button goes while it is under way.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
  });
});

describe("ThreadStrip", () => {
  it("names the thread, tags its topic (opening the topic's page), and goes Home", () => {
    const onOpenTopic = vi.fn();
    const onLeave = vi.fn();
    const thread = {
      id: "aa11",
      key: "topic:aa11",
      name: "Phone can't reach Takode",
      leaderId: "l1",
      createdAt: 1,
      activityAt: 1,
    };
    const { rerender } = render(
      <ThreadStrip thread={thread} topic={null} onOpenTopic={onOpenTopic} onLeave={onLeave} />,
    );
    expect(screen.getByTestId("thread-strip").textContent).toContain("Phone can't reach Takode");
    // Unfiled: no tag yet.
    expect(screen.queryByTestId("thread-topic-tag")).toBeNull();
    rerender(
      <ThreadStrip
        thread={thread}
        topic={{ id: "t1", name: "Remote access" }}
        onOpenTopic={onOpenTopic}
        onLeave={onLeave}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-topic-tag"));
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("thread-strip-leave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
