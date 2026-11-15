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

  it("records a group DM read once the session was sent a link to it", () => {
    // Slack prints group DMs as "Group DM" with a C… ID; older ones have G… IDs.
    const printed = "Channel: Group DM (C7)\n\n=== Message from A (U1) at t ===\nMessage TS: 5.000001\nhi";
    const unlinked = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "C7" }, printed);
    expect(slackReadsInToolResults(unlinked.session, unlinked.results)).toEqual([]);

    // A link to the conversation itself, without a message part, counts too.
    const link = {
      type: "user_message",
      content: "moved to https://x.slack.com/archives/C7",
    } as never;
    const linked = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "C7" }, printed, [link]);
    expect(slackReadsInToolResults(linked.session, linked.results)).toEqual([
      { channelId: "C7", label: "Group DM", seenTs: "5.000001" },
    ]);

    const oldLink = {
      type: "user_message",
      content: "https://x.slack.com/archives/G7/p5000001",
    } as never;
    const old = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "G7" }, "Channel: x (G7)", [oldLink]);
    expect(slackReadsInToolResults(old.session, old.results, 9_000)).toEqual([
      { channelId: "G7", label: "x", seenTs: "9.000000" },
    ]);
    // A link to another conversation whose ID starts the same is not a link to this one.
    const other = {
      type: "user_message",
      content: "https://x.slack.com/archives/C77",
    } as never;
    const notLinked = sessionWithRead("mcp__slack__slack_read_channel", { channel_id: "C7" }, printed, [other]);
    expect(slackReadsInToolResults(notLinked.session, notLinked.results)).toEqual([]);
  });

  it("counts a concise read, which prints no message timestamps, as seen up to when it was read", () => {
    // Agents mostly read with response_format "concise". Without this, such a
    // read neither starts watching nor moves the seen point, so updates repeat
    // messages the agent already read.
    const thread = sessionWithRead(
      "mcp__slack__slack_read_thread",
      {
        channel_id: "C1",
        message_ts: "100.000001",
        response_format: "concise",
      },
      "THREAD: eval proposal [Jiayi Wei]\n\n> Feng Chen: sounds good\n",
    );
    expect(slackReadsInToolResults(thread.session, thread.results, 1_794_727_743_512)).toEqual([
      {
        channelId: "C1",
        threadTs: "100.000001",
        label: "eval proposal",
        seenTs: "1794727743.000000",
      },
    ]);

    const link = {
      type: "user_message",
      content: "https://x.slack.com/archives/D1/p1",
    } as never;
    const dm = sessionWithRead(
      "mcp__slack__slack_read_channel",
      { channel_id: "D1", limit: 5, response_format: "concise" },
      "Channel: DM (D1)\n\nYang Zou: hi [2026-11-14 23:09:34 PST]",
      [link],
    );
    expect(slackReadsInToolResults(dm.session, dm.results, 2_000)).toEqual([
      { channelId: "D1", label: "DM", seenTs: "2.000000" },
    ]);
  });

  it("does not take the read time for a concise read of an older part of the conversation", () => {
    const printed = "THREAD: eval [A]\n\n> B: first reply";
    const latest = sessionWithRead(
      "mcp__slack__slack_read_thread",
      { channel_id: "C1", message_ts: "1.000001", latest: "50.000000" },
      printed,
    );
    expect(slackReadsInToolResults(latest.session, latest.results, 99_000)).toEqual([]);

    const page = sessionWithRead(
      "mcp__slack__slack_read_thread",
      { channel_id: "C1", message_ts: "1.000001", cursor: "abc" },
      printed,
    );
    expect(slackReadsInToolResults(page.session, page.results, 99_000)).toEqual([]);

    // A thread read that stopped before its newest replies.
    const cut = sessionWithRead("mcp__slack__slack_read_thread", { channel_id: "C1", message_ts: "1.000001" }, printed);
    cut.results[0]!.content = JSON.stringify({
      messages: printed,
      pagination_info: "There are more messages in this thread. To view the next page, use cursor: `x`\n",
    });
    expect(slackReadsInToolResults(cut.session, cut.results, 99_000)).toEqual([]);
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
        introduce: true,
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

  it("stops watching 3 days after the last read, and for archived sessions", async () => {
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
    now += 3 * DAY;
    await watch.poll();
    expect(slack.reads).toEqual(["C1/1.000001>1.000001"]);

    now += 1;
    await watch.poll();
    expect(slack.reads).toHaveLength(1);
  });

  it("watches only the 10 conversations a session read most recently", async () => {
    const watch = makeWatch();
    const read = (sessionId: string, n: number) =>
      watch.recordRead(sessionId, {
        channelId: `C${n}`,
        threadTs: "1.000001",
        label: `t${n}`,
        seenTs: "1.000001",
      });
    for (let n = 1; n <= 10; n++) {
      read("s1", n);
      now += 1;
    }
    read("s2", 99);
    // A re-read makes C1 recent again, so the 11th read drops C2, the least recently read.
    read("s1", 1);
    now += 1;
    read("s1", 11);
    await watch.poll();
    const checked = slack.reads.map((r) => r.split("/")[0]).sort();
    expect(checked).toEqual(["C1", "C10", "C11", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C99"]);
  });

  it("checks a session's conversations when its user starts writing, at most once a minute each", async () => {
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
    slack.thread.set("C1/1.000001", [message("2.000001")]);

    await watch.refresh("s1");
    // Only the conversations of the session being written to.
    expect(slack.reads).toEqual(["C1/1.000001>1.000001"]);
    expect(watch.takeUpdates("s1")?.updates[0]!.messages).toEqual([message("2.000001")]);

    // Typing goes on: nothing is read again within the minute.
    now += 59_999;
    await watch.refresh("s1");
    expect(slack.reads).toHaveLength(1);
    now += 1;
    await watch.refresh("s1");
    expect(slack.reads).toEqual(["C1/1.000001>1.000001", "C1/1.000001>2.000001"]);

    // The regular check still reads everything.
    await watch.poll();
    expect(slack.reads.slice(2).sort()).toEqual(["C1/1.000001>2.000001", "C2/1.000001>1.000001"]);
  });

  it("does not read a conversation twice at once, and counts an unreachable Slack as checked", async () => {
    const watch = makeWatch();
    watch.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    // The regular check ignores how recently a conversation was read, so only the in-flight guard stops this.
    const first = watch.poll();
    await watch.poll();
    await first;
    expect(slack.reads).toHaveLength(1);

    // While Slack is unreachable, typing does not retry it within the minute.
    available = false;
    now += 60_000;
    let opened = 0;
    const counting = new SlackConversationWatch({
      statePath: join(root, "other.json"),
      openReader: async () => {
        opened++;
        return openReader();
      },
      isSessionActive: () => true,
      now: () => now,
      log: () => {},
    });
    watches.push(counting);
    counting.recordRead("s1", {
      channelId: "C1",
      threadTs: "1.000001",
      label: "eval",
      seenTs: "1.000001",
    });
    await counting.refresh("s1");
    await counting.refresh("s1");
    expect(opened).toBe(1);
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
        content: expect.stringContaining('`C1/1.000001`: thread "eval proposal"'),
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
    expect(attached.message.deliveryContent).toContain('`C1/1.000001`: thread "eval proposal", read in q-12');
  });

  it("names a conversation and explains the format only the first time", async () => {
    // Jiayi found repeated notices noisy: the second update of the same thread
    // carries only its ID and the new messages; a conversation first seen later
    // gets its title, but the format is not explained again.
    const { watch, session } = await watchWithUpdates("q-12");
    const first = attachSlackUpdates(session, userMessage("one"))!;
    expect(first.message.deliveryContent).toContain("Only messages you have not seen are shown");
    first.accept();

    slack.thread.set("C1/1.000001", [message("2.000001", "new reply"), message("3.000001", "another reply")]);
    watch.recordRead("s1", { channelId: "C2", threadTs: "9.000001", label: "other thread", seenTs: "9.000001" });
    slack.thread.set("C2/9.000001", [message("10.000001", "other news")]);
    await watch.poll();
    const second = attachSlackUpdates(session, userMessage("two"))!.message.deliveryContent!;
    expect(second).not.toContain("Only messages you have not seen are shown");
    expect(second).not.toContain("eval proposal");
    expect(second).toContain("`C1/1.000001`\n\n**Weixin Wu**");
    expect(second).toContain("> another reply");
    expect(second).not.toContain("> new reply");
    expect(second).toContain('`C2/9.000001`: thread "other thread"');
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
