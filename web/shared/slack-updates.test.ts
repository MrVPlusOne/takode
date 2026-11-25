import { describe, expect, it } from "vitest";
import {
  compareSlackTs,
  formatSlackUpdatesNotice,
  parseSlackChannelName,
  parseSlackMessages,
  parseSlackPermalinkOrigin,
  parseSlackSearchCursor,
  parseSlackSearchMessages,
  slackMarkdown,
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
        replies: 7,
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

  it("keeps a thread's reply count when Slack prints it before forwarded text", () => {
    // From a live group DM read: the reply count sits between the message and
    // the forwarded message it carries, so it is not trailing metadata.
    const [forwarded] = parseSlackMessages(
      [
        "=== Message from Frank Xu (U08BC1BR7D4) at 2026-11-18 18:47:11 PST === ",
        "Message TS: 1795056431.217309",
        "<@U09TLUFKAQ4|Qingyu Chen> 你要不看看这个",
        "Thread: 16 replies (latest: 2026-11-18 19:31:44 PST)",
        "Forwarded message from Timo Schick: btw this is papyrus usage",
      ].join("\n"),
    );
    expect(forwarded).toEqual({
      ts: "1795056431.217309",
      author: "Frank Xu",
      time: "2026-11-18 18:47:11 PST",
      text: "<@U09TLUFKAQ4|Qingyu Chen> 你要不看看这个\nForwarded message from Timo Schick: btw this is papyrus usage",
      replies: 16,
    });
  });
});

describe("parseSlackMessages, as Slack's tools print text since November 2026", () => {
  // From a live group DM read: every line of a message's text, its reply count
  // and reactions come behind `> `, and a quote in the message itself as `> > `.
  it("reads the text without the tool's quoting, keeping the message's own quote", () => {
    const messages = parseSlackMessages(
      [
        "=== Message from Boxuan Li (U0ABEA5JMTK) at 2026-11-19 14:31:30 PST === ",
        "Message TS: 1795127490.643249",
        "> <#C0CD5MC939A>",
        "> Thread: 1 replies (latest: 2026-11-19 15:46:36 PST)",
        "> Reactions: 6-balloon (1)",
        "",
        "--- Reply 14 of 100 ---",
        "From: Frank Xu (U08BC1BR7D4)",
        "Time: 2026-11-16 22:50:11 PST",
        "Message TS: 1794898211.703659",
        "> > 他来私聊我的",
        "> 私聊你什么？",
        ">",
        "> second paragraph",
      ].join("\n"),
    );
    expect(messages).toEqual([
      {
        ts: "1795127490.643249",
        author: "Boxuan Li",
        time: "2026-11-19 14:31:30 PST",
        text: "<#C0CD5MC939A>",
        replies: 1,
      },
      {
        ts: "1794898211.703659",
        author: "Frank Xu",
        time: "2026-11-16 22:50:11 PST",
        text: "> 他来私聊我的\n私聊你什么？\n\nsecond paragraph",
      },
    ]);
  });
});

describe("parseSlackSearchMessages", () => {
  // As a detailed `slack_search_public_and_private` search (`in:<#C…> is:thread`)
  // printed it in a live group DM, participant lists shortened.
  const SEARCH_TEXT = [
    "# Search Results for: ",
    "",
    "## Messages (3 results)",
    "### Result 1 of 3",
    "Channel: Group DM (ID: C0C0AJ3JLL8)",
    "Participants: Jiayi Wei (ID: U0964LU3BUZ), Junhong Shen (ID: U0AGBRAGMFA)",
    "From: Junhong Shen (ID: U0AGBRAGMFA) ",
    "Time: 2026-11-20 14:20:17 PST",
    "Message_ts: 1795213217.145369",
    "Reply count: 38",
    "Permalink: [link](https://acme.enterprise.slack.com/archives/C0C0AJ3JLL8/p1795213217145369?thread_ts=1795213217.145369&cid=C0C0AJ3JLL8)",
    "Text: ",
    "如果你要是新建一个按道理要重新12b->77b",
    "",
    "---",
    "",
    "### Result 2 of 3",
    "Channel: Group DM (ID: C0C0AJ3JLL8)",
    "From: Wenxu Mao (ID: U0AM9ST0TL1) ",
    "Time: 2026-11-20 15:44:08 PST",
    "Message_ts: 1795218248.073529",
    "Permalink: [link](https://acme.enterprise.slack.com/archives/C0C0AJ3JLL8/p1795218248073529?thread_ts=1795213217.145369&cid=C0C0AJ3JLL8)",
    "Text: ",
    "应该不会restart?",
    "> quoted line",
    "",
    "---",
    "",
    "### Result 3 of 3",
    "Channel: Group DM (ID: C0C0AJ3JLL8)",
    "From:  (ID: U00)  [BOT]",
    "Time: 2026-11-20 16:03:18 PST",
    "Message_ts: 1795219398.946179",
    "Permalink: [link](https://acme.enterprise.slack.com/archives/C0C0AJ3JLL8/p1795219398946179?thread_ts=1795219398.310939&cid=C0C0AJ3JLL8)",
    "Text: ",
    "This channel aims to resolve all feature requests.",
    "",
    "---",
    "",
  ].join("\n");

  it("reads each result, naming the thread a reply belongs to", () => {
    expect(parseSlackSearchMessages(SEARCH_TEXT)).toEqual([
      // A thread's first message names itself as the thread: it is no reply.
      {
        ts: "1795213217.145369",
        author: "Junhong Shen",
        time: "2026-11-20 14:20:17 PST",
        text: "如果你要是新建一个按道理要重新12b->77b",
        replies: 38,
      },
      {
        ts: "1795218248.073529",
        author: "Wenxu Mao",
        time: "2026-11-20 15:44:08 PST",
        text: "应该不会restart?\n> quoted line",
        threadTs: "1795213217.145369",
      },
      {
        ts: "1795219398.946179",
        author: "",
        time: "2026-11-20 16:03:18 PST",
        text: "This channel aims to resolve all feature requests.",
        threadTs: "1795219398.310939",
      },
    ]);
  });

  it("reads search text without the tool's quoting", () => {
    // From the live search behind the Nov 24 report, where each message showed
    // two quote bars: the tool quotes every line of a result's text.
    const [message] = parseSlackSearchMessages(
      [
        "### Result 1 of 1",
        "From: Boxuan Li (ID: U0ABEA5JMTK) ",
        "Time: 2026-11-24 18:02:27 PST",
        "Message_ts: 1795572147.514069",
        "Permalink: [link](https://acme.enterprise.slack.com/archives/C0C0AJ3JLL8/p1795572147514069?thread_ts=1794897889.052189&cid=C0C0AJ3JLL8)",
        "Text: ",
        "> ```# Printed when the grader left no usable grade.",
        '> MARKER = "GRADER_UNAVAILABLE"```',
        "",
        "---",
        "",
      ].join("\n"),
    );
    expect(message!.text).toBe('```# Printed when the grader left no usable grade.\nMARKER = "GRADER_UNAVAILABLE"```');
  });

  it("finds the next page's cursor", () => {
    expect(parseSlackSearchCursor("For the next page of results use cursor `Q1VSUkVOVF9QQUdFOjI=`\n")).toBe(
      "Q1VSUkVOVF9QQUdFOjI=",
    );
    expect(parseSlackSearchCursor("End of results - No more pages available.\\n")).toBeNull();
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

describe("parseSlackPermalinkOrigin", () => {
  it("reads the workspace address from a search result's permalink", () => {
    // As `slack_search_public_and_private` returned it (from a live search, text shortened).
    const result = JSON.stringify({
      results: [
        "# Search Results for: ",
        "",
        "## Messages (1 results)",
        "### Result 1 of 1",
        "Channel: #sq-bc-coding-qa (ID: C0BQED9JD8F)",
        "Message_ts: 1795036624.571469",
        "Permalink: [link](https://microsoft-ai.enterprise.slack.com/archives/C0BQED9JD8F/p1795036624571469?thread_ts=1794776813.089009&cid=C0BQED9JD8F)",
        "Text: ",
        "thx I see",
      ].join("\n"),
      pagination_info: "",
    });
    expect(parseSlackPermalinkOrigin([{ type: "text", text: result }])).toBe(
      "https://microsoft-ai.enterprise.slack.com",
    );
    expect(parseSlackPermalinkOrigin(JSON.stringify({ results: "## Messages (0 results)" }))).toBeNull();
    // Only Slack's own addresses become link targets.
    const elsewhere = JSON.stringify({ results: "Permalink: [link](https://example.com/archives/C1)" });
    expect(parseSlackPermalinkOrigin(elsewhere)).toBeNull();
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

describe("slackMarkdown", () => {
  it("puts a code block's fences on lines of their own, keeping its first line", () => {
    // Slack opens and closes a code block mid-line; as Markdown, text after an
    // opening fence is its language and a closing fence must start a line.
    expect(slackMarkdown('```# Printed when no grade.\nMARKER = "X"```')).toBe(
      ["```", "# Printed when no grade.", 'MARKER = "X"', "```"].join("\n"),
    );
    expect(slackMarkdown("see ```a &lt;b&gt; <https://x.io|x>``` then\nmore")).toBe(
      ["see ", "```", "a <b> x", "```", " then", "more"].join("\n"),
    );
    // A fence never closed is just backticks.
    expect(slackMarkdown("three ``` ticks")).toBe("three ``` ticks");
  });

  it("turns links, mentions and channels into what Slack shows", () => {
    expect(
      slackMarkdown(
        "<@U09TLUFKAQ4|Qingyu Chen> see <https://ex.com/a_(b)|the doc> in <#C0CD5MC939A|fv-eval> and <#C0CD5MC939A>, <!here>",
      ),
    ).toBe("@Qingyu Chen see [the doc](https://ex.com/a_%28b%29) in #fv-eval and #C0CD5MC939A, @here");
    expect(slackMarkdown("<https://msi.example.com/d> or <https://x.io|https://x.io> to <!subteam^S1|@fv-team>")).toBe(
      "<https://msi.example.com/d> or <https://x.io> to @fv-team",
    );
    // Angle brackets that are not Slack markup stay as typed.
    expect(slackMarkdown("a <b> c")).toBe("a <b> c");
  });

  it("makes Slack's bold Markdown bold and decodes Slack's escapes, but not inside code", () => {
    expect(slackMarkdown("*Pro:* fast, 2*3*4, x &amp; y &gt; z")).toBe("**Pro:** fast, 2*3*4, x & y > z");
    expect(slackMarkdown("`*a* &gt; 3` and *b*")).toBe("`*a* > 3` and **b**");
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
      '`C1/1.000001`: thread "eval proposal", read in q-12\n\n**Weixin Wu** 16:51 PST\n> line one\n> line two',
    );
    expect(notice).toContain("+2 newer messages not shown.");
    expect(notice).toContain('`D1`: direct messages "@Yang Zou"');
  });

  it("links each conversation's first new message in Slack when given the workspace address", () => {
    const notice = formatSlackUpdatesNotice(
      [
        { ...thread, omitted: 0, introduce: false },
        {
          channelId: "D1",
          label: "DM",
          messages: [{ ts: "3.000001", author: "Yang Zou", time: "17:03 PST", text: "sent" }],
          omitted: 0,
          introduce: false,
        },
        // Only an oversized message waiting: the thread itself is linked.
        { ...thread, threadTs: "5.000001", messages: [], omitted: 1, introduce: false },
      ],
      { explain: false, linkOrigin: "https://acme.slack.com" },
    );
    expect(notice).toContain(
      "`C1/1.000001` · [Open in Slack](https://acme.slack.com/archives/C1/p2000001?thread_ts=1.000001&cid=C1)",
    );
    expect(notice).toContain("`D1` · [Open in Slack](https://acme.slack.com/archives/D1/p3000001)");
    expect(notice).toContain("`C1/5.000001` · [Open in Slack](https://acme.slack.com/archives/C1/p5000001)");
  });

  it("groups replies under their thread and gives each date and time zone once", () => {
    // Jiayi (Nov 21): with many replies in one thread, every line repeated the
    // thread ID, the date and the time zone. A reply now follows the message
    // that started its thread (or one `In thread` line naming it), and a time
    // carries its date and zone only when they change.
    const at = (clock: string, date = "2026-11-21") => `${date} ${clock} PST`;
    const update = {
      channelId: "C7",
      label: "Group DM",
      messages: [
        { ts: "30.000001", author: "Cleo Ito", time: at("23:35:18"), text: "older thread", threadTs: "5.000001" },
        { ts: "10.000001", author: "Ada Park", time: at("23:25:28"), text: "why?", replies: 1 },
        { ts: "20.000001", author: "Ben Ortiz", time: at("23:27:47"), text: "no idea", threadTs: "10.000001" },
        {
          ts: "40.000001",
          author: "Ben Ortiz",
          time: at("00:02:02", "2026-11-22"),
          text: "reverted",
          threadTs: "10.000001",
        },
        { ts: "50.000001", author: "Ada Park", time: at("00:05:00", "2026-11-22"), text: "thanks", replies: 4 },
      ],
      omitted: 0,
      introduce: false,
    };
    expect(formatSlackUpdatesNotice([update], { explain: false })).toBe(
      [
        "[Slack updates] 5 new messages in Slack conversations you read.",
        "",
        "`C7`",
        "",
        // Its replies follow, so Slack's earlier reply count is left out.
        "**Ada Park** 2026-11-21 23:25 PST · thread `C7/10.000001`",
        "> why?",
        "",
        "↳ **Ben Ortiz** 23:27",
        "> no idea",
        "",
        "↳ **Ben Ortiz** 2026-11-22 00:02 PST",
        "> reverted",
        "",
        "In thread `C7/5.000001`:",
        "",
        "↳ **Cleo Ito** 2026-11-21 23:35 PST",
        "> older thread",
        "",
        "**Ada Park** 2026-11-22 00:05 PST · 4 replies in thread `C7/50.000001`",
        "> thanks",
      ].join("\n"),
    );
    // When the first new message is a reply, the feed's link opens it in its thread.
    const replyFirst = { ...update, messages: [update.messages[2]!] };
    expect(formatSlackUpdatesNotice([replyFirst], { explain: false, linkOrigin: "https://acme.slack.com" })).toContain(
      "[Open in Slack](https://acme.slack.com/archives/C7/p20000001?thread_ts=10.000001&cid=C7)",
    );
  });

  it("gives a date once across conversations, and again when the time zone changes", () => {
    const message = (ts: string, time: string) => ({ ts, author: "Yang Zou", time, text: "hi" });
    const notice = formatSlackUpdatesNotice(
      [
        {
          channelId: "D1",
          label: "DM",
          messages: [message("1.000001", "2026-11-21 09:00:00 PST")],
          omitted: 0,
          introduce: false,
        },
        {
          channelId: "C1",
          threadTs: "2.000001",
          label: "eval",
          messages: [message("3.000001", "2026-11-21 09:05:00 PST"), message("4.000001", "2026-11-21 12:06:00 EST")],
          omitted: 0,
          introduce: false,
        },
      ],
      { explain: false },
    );
    expect(notice).toContain("**Yang Zou** 2026-11-21 09:00 PST");
    expect(notice).toContain("**Yang Zou** 09:05\n");
    expect(notice).toContain("**Yang Zou** 2026-11-21 12:06 EST");
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
        "**Weixin Wu** 16:51 PST",
        "> line one",
        "> line two",
      ].join("\n"),
    );
  });

  it("shows a message once quoted, with its code block complete", () => {
    // The Nov 24 report: Slack's tool quoted each line again and the code
    // block opened mid-line, so the message showed two quote bars, lost its
    // first line and ended with stray backticks.
    const [message] = parseSlackSearchMessages(
      [
        "### Result 1 of 1",
        "From: Boxuan Li (ID: U0ABEA5JMTK) ",
        "Time: 2026-11-24 18:02:27 PST",
        "Message_ts: 1795572147.514069",
        "Permalink: [link](https://acme.slack.com/archives/C1/p1795572147514069?thread_ts=1.000001&cid=C1)",
        "Text: ",
        "> ```# Printed when no grade.",
        '> MARKER = "X"```',
      ].join("\n"),
    );
    const notice = formatSlackUpdatesNotice(
      [{ channelId: "C1", label: "Group DM", messages: [message!], omitted: 0, introduce: false }],
      { explain: false },
    );
    expect(notice.split("\n").slice(-7)).toEqual([
      "In thread `C1/1.000001`:",
      "",
      "↳ **Boxuan Li** 2026-11-24 18:02 PST",
      "> ```",
      "> # Printed when no grade.",
      '> MARKER = "X"',
      "> ```",
    ]);
  });
});
