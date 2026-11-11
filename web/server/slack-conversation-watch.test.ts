import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SLACK_UPDATES_SOURCE, type SlackMessage } from "../shared/slack-updates.js";
import type { BrowserUserMessage } from "./bridge/adapter-browser-routing-message-types.js";
import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";
import type { OpenSlackReader, SlackReadConnection } from "./slack-reader.js";
import {
  attachSlackUpdates,
  recordSlackReads,
  resetSlackConversationWatchForTest,
  SlackConversationWatch,
  slackReadsInToolResults,
} from "./slack-conversation-watch.js";

type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

const DAY = 24 * 60 * 60_000;
let root: string;
let now: number;
let active: Set<string>;
let slack: {
  thread: Map<string, SlackMessage[]>;
  channel: Map<string, SlackMessage[]>;
  reads: string[];
};
let available: boolean;
let watches: SlackConversationWatch[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "slack-watch-"));
  now = 1_000_000;
  active = new Set(["s1", "s2"]);
  slack = { thread: new Map(), channel: new Map(), reads: [] };
  available = true;
  watches = [];
});

afterEach(async () => {
  resetSlackConversationWatchForTest();
  // State writes are fire-and-forget; let them finish before removing their folder.
  await Promise.all(watches.map((watch) => watch.flush()));
  await rm(root, { recursive: true, force: true });
});

/** A fake Slack: returns the messages it holds newer than `oldest`, as Slack's `oldest` does. */
const openReader: OpenSlackReader = async () => {
  if (!available) return { ok: false, reason: "login expired" };
  const newer = (messages: SlackMessage[] | undefined, oldest: string) =>
    (messages ?? []).filter((message) => Number(message.ts) > Number(oldest));
  const connection: SlackReadConnection = {
    readThread: async (channelId, threadTs, oldest) => {
      slack.reads.push(`${channelId}/${threadTs}>${oldest}`);
      return newer(slack.thread.get(`${channelId}/${threadTs}`), oldest);
    },
    readChannel: async (channelId, oldest) => {
      slack.reads.push(`${channelId}>${oldest}`);
      return newer(slack.channel.get(channelId), oldest).reverse();
    },
    close: async () => {},
  };
  return { ok: true, connection };
};

function makeWatch(): SlackConversationWatch {
  const watch = new SlackConversationWatch({
    statePath: join(root, "watch.json"),
    openReader,
    isSessionActive: (id) => active.has(id),
    now: () => now,
    log: () => {},
  });
  watches.push(watch);
  return watch;
}

function message(ts: string, text = `message ${ts}`): SlackMessage {
  return { ts, author: "Weixin Wu", time: "16:51 PST", text };
}

function printedThread(messages: SlackMessage[]): string {
  return messages
    .map(
      (m, i) =>
        `${i === 0 ? "=== THREAD PARENT MESSAGE ===" : `--- Reply ${i} of ${messages.length - 1} ---`}\nFrom: ${m.author} (U1)\nTime: ${m.time}\nMessage TS: ${m.ts}\n${m.text}`,
    )
    .join("\n\n");
}

/** A session whose history holds one Slack tool call, and that call's result. */
function sessionWithRead(
  name: string,
  input: Record<string, unknown>,
  resultText: string,
  extraHistory: BrowserIncomingMessage[] = [],
): {
  session: { id: string; messageHistory: BrowserIncomingMessage[] };
  results: ToolResult[];
} {
  const toolUse = { type: "tool_use", id: "tu-1", name, input };
  return {
    session: {
      id: "s1",
      messageHistory: [...extraHistory, { type: "assistant", message: { content: [toolUse] } } as never],
    },
    results: [
      {
        type: "tool_result",
        tool_use_id: "tu-1",
        content: JSON.stringify({ messages: resultText }),
      } as ToolResult,
    ],
  };
}

function userMessage(content: string, extra: Partial<BrowserUserMessage> = {}): BrowserUserMessage {
  return { type: "user_message", content, ...extra } as BrowserUserMessage;
}

describe("slackReadsInToolResults", () => {
  it("records a thread read up to the newest message the agent saw, labeled by its first message", () => {
    const { session, results } = sessionWithRead(
      "mcp__slack__slack_read_thread",
      { channel_id: "C1", message_ts: "100.000001" },
      printedThread([message("100.000001", "eval proposal"), message("200.000002"), message("150.000003")]),
    );
    expect(slackReadsInToolResults(session, results)).toEqual([
      {
        channelId: "C1",
        threadTs: "100.000001",
        label: "eval proposal",
        seenTs: "200.000002",
      },
    ]);
  });

  it("records a direct-message read only when the session was sent a link into it", () => {
    const printed =
      "Channel: @Yang Zou (D1)\n\n=== Message from Yang Zou (U2) at 17:03 PST ===\nMessage TS: 300.000001\nhi";
    const unlinked = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "D1" }, printed);
    expect(slackReadsInToolResults(unlinked.session, unlinked.results)).toEqual([]);

    const link = {
      type: "user_message",
      content: "see https://x.slack.com/archives/D1/p300000001",
    } as never;
    const linked = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "D1" }, printed, [link]);
    expect(slackReadsInToolResults(linked.session, linked.results)).toEqual([
      { channelId: "D1", label: "@Yang Zou", seenTs: "300.000001" },
    ]);
  });

  it("ignores channel reads outside direct messages, other tools and failed reads", () => {
    // A briefing scanning a channel must not start watching it, even when linked.
    const link = {
      type: "user_message",
      content: "https://x.slack.com/archives/C9/p1",
    } as never;
    const printed = "=== Message from A (U1) at t ===\nMessage TS: 1.000001\nx";
    const channel = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "C9" }, printed, [link]);
    expect(slackReadsInToolResults(channel.session, channel.results)).toEqual([]);

    const other = sessionWithRead("mcp__slack__slack_search_public", { channel_id: "C9" }, printed);
    expect(slackReadsInToolResults(other.session, other.results)).toEqual([]);

    const failed = sessionWithRead(
      "mcp__slack__slack_read_thread",
      { channel_id: "C1", message_ts: "1.000001" },
      printed,
    );
    failed.results[0]!.is_error = true;
    expect(slackReadsInToolResults(failed.session, failed.results)).toEqual([]);
  });
});

describe("SlackConversationWatch", () => {
  it("collects new messages after what the session read, and clears them once told", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "100.000001",
      label: "eval",
      seenTs: "200.000001",
    });
    slack.thread.set("C1/100.000001", [message("100.000001"), message("200.000001"), message("300.000001")]);

    await watch.poll();
    expect(slack.reads).toEqual(["C1/100.000001>200.000001"]);
    const taken = watch.takeUpdates("s1");
    expect(taken?.updates).toEqual([
      {
        channelId: "C1",
        threadTs: "100.000001",
        label: "eval",
        messages: [message("300.000001")],
        omitted: 0,
      },
    ]);

    taken!.accept();
    expect(watch.takeUpdates("s1")).toBeNull();
    // The next check starts after what the session was told.
    await watch.poll();
    expect(slack.reads.at(-1)).toBe("C1/100.000001>300.000001");
    expect(watch.takeUpdates("s1")).toBeNull();
  });

  it("drops waiting messages the session has since read itself", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    slack.thread.set("C1/1.000001", [message("2.000001"), message("3.000001")]);
    await watch.poll();

    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "2.000001",
    });
    expect(watch.takeUpdates("s1")?.updates[0]!.messages).toEqual([message("3.000001")]);
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "3.000001",
    });
    expect(watch.takeUpdates("s1")).toBeNull();
  });

  it("keeps message text within the budget and counts the rest", async () => {
    // Messages are never cut: once one does not fit, it and every later one are only counted.
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    slack.thread.set("C1/1.000001", [
      message("2.000001", "a".repeat(3_000)),
      message("3.000001", "b".repeat(1_500)),
      message("4.000001", "short"),
    ]);
    await watch.poll();
    const update = watch.takeUpdates("s1")!.updates[0]!;
    expect(update.messages.map((m) => m.ts)).toEqual(["2.000001"]);
    expect(update.omitted).toBe(2);
  });

  it("reads a conversation once for every session watching it, from the oldest point", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "5.000001",
    });
    watch.recordRead("s2", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "3.000001",
    });
    slack.thread.set("C1/1.000001", [message("4.000001"), message("6.000001")]);
    await watch.poll();
    expect(slack.reads).toEqual(["C1/1.000001>3.000001"]);
    expect(watch.takeUpdates("s1")!.updates[0]!.messages.map((m) => m.ts)).toEqual(["6.000001"]);
    expect(watch.takeUpdates("s2")!.updates[0]!.messages.map((m) => m.ts)).toEqual(["4.000001", "6.000001"]);
  });

  it("stops watching a week after the last read, and for archived sessions", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    watch.recordRead("s2", {
      channelId: "C2",
      threadTs: "1.000001",
      label: "other",
      seenTs: "1.000001",
    });
    active.delete("s2");
    now += 7 * DAY;
    await watch.poll();
    expect(slack.reads).toEqual(["C1/1.000001>1.000001"]);

    now += 1;
    await watch.poll();
    expect(slack.reads).toHaveLength(1);
  });

  it("waits without changes while Slack cannot be read, and saves its state", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    slack.thread.set("C1/1.000001", [message("2.000001")]);
    available = false;
    await watch.poll();
    expect(watch.takeUpdates("s1")).toBeNull();

    available = true;
    await watch.poll();
    await watch.flush();
    const reloaded = makeWatch();
    await reloaded.load();
    expect(reloaded.takeUpdates("s1")?.updates[0]!.messages).toEqual([message("2.000001")]);
    expect(JSON.parse(await readFile(join(root, "watch.json"), "utf-8")).conversations).toHaveLength(1);
  });
});

describe("attachSlackUpdates", () => {
  async function watchWithUpdates(threadKey?: string) {
    const watch = makeWatch();
    resetSlackConversationWatchForTest(watch);
    const read = sessionWithRead(
      "mcp__slack__slack_read_thread",
      { channel_id: "C1", message_ts: "1.000001" },
      printedThread([message("1.000001", "eval proposal")]),
    );
    recordSlackReads(read.session, read.results, threadKey ? { threadKey, questId: threadKey } : { threadKey: "main" });
    slack.thread.set("C1/1.000001", [message("2.000001", "new reply")]);
    await watch.poll();
    return { watch, session: read.session };
  }

  it("adds the notice to the next input and marks the updates told once accepted", async () => {
    const { watch, session } = await watchWithUpdates();
    const attached = attachSlackUpdates(session, userMessage("hello"))!;
    expect(attached.message.deliveryContent).toMatch(/^hello\n\n\[Slack updates\] 1 new message/);
    expect(attached.message.deliveryContent).toContain("> new reply");
    expect(attached.message.historyFollowUps).toEqual([
      {
        content: expect.stringContaining("### Thread: eval proposal"),
        agentSource: SLACK_UPDATES_SOURCE,
      },
    ]);
    // Not accepted yet: still waiting.
    expect(watch.takeUpdates("s1")).not.toBeNull();
    attached.accept();
    expect(watch.takeUpdates("s1")).toBeNull();
  });

  it("shows a leader's notice in the thread the conversation was read in", async () => {
    const { session } = await watchWithUpdates("q-12");
    const attached = attachSlackUpdates(session, userMessage("hello", { threadKey: "q-40" } as never))!;
    expect(attached.message.historyFollowUps).toEqual([
      expect.objectContaining({
        threadKey: "q-12",
        questId: "q-12",
        agentSource: SLACK_UPDATES_SOURCE,
      }),
    ]);
    expect(attached.message.deliveryContent).toContain("You read it in thread q-12.");
  });

  it("leaves Takode's own messages and inputs with images alone", async () => {
    const { watch, session } = await watchWithUpdates();
    const system = userMessage("recovery", {
      agentSource: { sessionId: "system:compaction-recovery" },
    });
    expect(attachSlackUpdates(session, system)).toBeNull();
    const withImage = userMessage("look", {
      imageRefs: [{ imageId: "i1", media_type: "image/png" }],
    } as never);
    expect(attachSlackUpdates(session, withImage)).toBeNull();
    // A leader or timer message is ordinary input and carries the updates.
    const timer = userMessage("timer", {
      agentSource: { sessionId: "timer:t1" },
    });
    expect(attachSlackUpdates(session, timer)).not.toBeNull();
    expect(watch.takeUpdates("s1")).not.toBeNull();
  });
});
