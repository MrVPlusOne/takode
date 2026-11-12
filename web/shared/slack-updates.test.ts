import { describe, expect, it } from "vitest";
import {
  compareSlackTs,
  formatSlackUpdatesNotice,
  parseSlackChannelName,
  parseSlackMessages,
  slackToolResultText,
} from "./slack-updates.js";

// Text as Slack's MCP `slack_read_thread` printed it (from a live read), with
// a quoted line and a link inside a reply.
const THREAD_TEXT = [
  "=== THREAD PARENT MESSAGE ===",
  "From: Aroma Mahendru (U098HTLRGUV)",
  "Time: 2026-11-05 13:39:58 PST",
  "Message TS: 1793914798.906149",
  "formal verification public benchmark nll eval  proposal :thread:",
  "Reactions: thankyou2 (7)",
  "",
  "=== THREAD REPLIES (2 total) ===",
  "",
  "--- Reply 1 of 2 ---",
  "From: Jiayi Wei (U0964LU3BUZ)",
  "Time: 2026-11-10 16:47:10 PST",
  "Message TS: 1794358030.612919",
  "maybe we can do both types of evals?",
  "",
  "--- Reply 2 of 2 ---",
  "From: Weixin Wu (U0A7UMYRCRG)",
  "Time: 2026-11-10 16:51:54 PST",
  "Message TS: 1794358314.762619",
  "> maybe we can do both types of evals?",
  "yeah, see <https://microsoft-ai.slack.com/archives/C0A2UQ5V0FK/p1794217747977149|this>",
].join("\n");

// Text as `slack_read_channel` printed it: newest first, with reply counts.
const CHANNEL_TEXT = [
  "Channel: #sq-pretraining-data-code (C0AMX973N8P)",
  "",
  "=== Message from Ming-Hao Yu (U090G4F70GN) at 2026-11-10 16:50:13 PST === ",
  "Message TS: 1794358213.821889",
  "[Question] Trace data knowledge extraction :thread:",
  "Thread: 7 replies (latest: 2026-11-10 17:46:38 PST)",
  "Reactions: thankyou2 (2)",
  "",
  "=== Message from Bing Zhang (U09PVA7PZAQ) at 2026-11-10 16:45:44 PST === ",
  "Message TS: 1794357944.595709",
  "Cross-pillar eval holdout",
].join("\n");

describe("parseSlackMessages", () => {
  it("reads authors, times, timestamps and text from a thread, dropping reactions", () => {
    const messages = parseSlackMessages(THREAD_TEXT);
    expect(messages.map((message) => message.ts)).toEqual([
      "1793914798.906149",
      "1794358030.612919",
      "1794358314.762619",
    ]);
    expect(messages[0]).toEqual({
      ts: "1793914798.906149",
      author: "Aroma Mahendru",
      time: "2026-11-05 13:39:58 PST",
      text: "formal verification public benchmark nll eval  proposal :thread:",
    });
    // Quoted lines and links are message text, not structure.
    expect(messages[2]!.text).toBe(
      "> maybe we can do both types of evals?\nyeah, see <https://microsoft-ai.slack.com/archives/C0A2UQ5V0FK/p1794217747977149|this>",
    );
  });

  it("reads channel messages and the channel name", () => {
    const messages = parseSlackMessages(CHANNEL_TEXT);
    expect(messages).toEqual([
      {
        ts: "1794358213.821889",
        author: "Ming-Hao Yu",
        time: "2026-11-10 16:50:13 PST",
        text: "[Question] Trace data knowledge extraction :thread:",
      },
      {
        ts: "1794357944.595709",
        author: "Bing Zhang",
        time: "2026-11-10 16:45:44 PST",
        text: "Cross-pillar eval holdout",
      },
    ]);
    expect(parseSlackChannelName(CHANNEL_TEXT)).toBe("#sq-pretraining-data-code");
  });
});

describe("slackToolResultText", () => {
  it("unwraps the JSON the tools return, from a string or content blocks", () => {
    const json = JSON.stringify({
      messages: THREAD_TEXT,
      pagination_info: "none",
    });
    expect(slackToolResultText(json)).toBe(THREAD_TEXT);
    expect(slackToolResultText([{ type: "text", text: json }])).toBe(THREAD_TEXT);
    expect(slackToolResultText("plain text")).toBe("plain text");
  });
});

describe("compareSlackTs", () => {
  it("orders timestamps exactly, beyond double precision", () => {
    // These two differ only in the last microsecond digit, which doubles lose.
    expect(compareSlackTs("1794358314.762619", "1794358314.762618")).toBe(1);
    expect(compareSlackTs("1794358314.762619", "1794358314.762619")).toBe(0);
    expect(compareSlackTs("999999999.9", "1000000000.0")).toBeLessThan(0);
  });
});

describe("formatSlackUpdatesNotice", () => {
  const thread = {
    channelId: "C1",
    threadTs: "1.000001",
    label: "eval proposal",
    messages: [{ ts: "2.000001", author: "Weixin Wu", time: "16:51 PST", text: "line one\nline two" }],
    omitted: 2,
    threadKey: "q-12",
  };

  it("names each conversation and explains the format in a session's first notice", () => {
    const notice = formatSlackUpdatesNotice(
      [
        { ...thread, introduce: true },
        {
          channelId: "D1",
          label: "@Yang Zou",
          messages: [{ ts: "3.000001", author: "Yang Zou", time: "17:03 PST", text: "sent" }],
          omitted: 0,
          introduce: true,
        },
      ],
      { explain: true },
    );
    const lines = notice.split("\n");
    expect(lines[0]).toBe("[Slack updates] 4 new messages in Slack conversations you read.");
    expect(lines[1]).toContain("`slack_read_thread`");
    expect(notice).toContain(
      '`C1/1.000001`: thread "eval proposal", read in q-12\n\n**Weixin Wu** (16:51 PST)\n> line one\n> line two',
    );
    expect(notice).toContain("+2 newer messages not shown.");
    expect(notice).toContain('`D1`: direct messages "@Yang Zou"');
  });

  it("carries only the conversation ID and new messages in a repeated update", () => {
    // Before/after: the first notice of a thread names it; a repeat is the
    // header line, the ID and the messages, nothing else.
    expect(formatSlackUpdatesNotice([{ ...thread, omitted: 0, introduce: false }], { explain: false })).toBe(
      [
        "[Slack updates] 1 new message in Slack conversations you read.",
        "",
        "`C1/1.000001`",
        "",
        "**Weixin Wu** (16:51 PST)",
        "> line one",
        "> line two",
      ].join("\n"),
    );
  });
});
