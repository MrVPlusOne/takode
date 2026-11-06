import { describe, expect, it } from "vitest";
import {
  comparePostParts,
  destinationLabel,
  draftAttachmentPaths,
  draftMarkdown,
  formatDraftPost,
  groupDraftPostsInMarkdown,
  parseDraftBlock,
  parseDestination,
  parseGroupedDraftPost,
  revisePostParts,
  slackNativeMentionTokens,
} from "./draft-posts.js";

/**
 * The rules of drafted posts that both the server (Library versions) and the feed (one card per
 * post) follow: a block's header and attachments, how a revision builds on the previous version,
 * how versions compare part by part, and how a message's blocks gather into one card.
 */

describe("draft blocks", () => {
  it("reads a title and part header and trailing attach lines, which are neither shown nor copied", () => {
    expect(
      parseDraftBlock(
        "title: T7 status\npart: 2\n---\nTwin is ahead.\n\nattach: /tmp/plot.png\nattach: <file:/tmp/b c.png>\n",
      ),
    ).toEqual({ title: "T7 status", part: 2, body: "Twin is ahead.", attachments: ["/tmp/plot.png", "/tmp/b c.png"] });
    // Without the closing `---` a header is just text; attach lines inside the text stay text.
    expect(parseDraftBlock("part: 2\nText\nattach: /tmp/a.png\nmore")).toEqual({
      body: "part: 2\nText\nattach: /tmp/a.png\nmore",
      attachments: [],
    });
  });

  it("revises named parts and carries the rest over, but takes unnumbered blocks as the whole post", () => {
    const previous = ["A", "B", "C"];
    expect(
      revisePostParts(previous, [
        { part: 2, value: "B2" },
        { part: 4, value: "D" },
      ]),
    ).toEqual(["A", "B2", "C", "D"]);
    expect(revisePostParts(previous, [{ value: "A" }, { value: "C" }])).toEqual(["A", "C"]);
    expect(revisePostParts(undefined, [{ part: 2, value: "B2" }])).toEqual(["B2"]);
  });

  it("marks parts same, edited or new against the previous version, and lists removed ones", () => {
    expect(comparePostParts(["A", "B", "C"], ["A", "B2", "C"])).toEqual({
      parts: ["same", "edited", "same"],
      removed: [],
    });
    expect(comparePostParts(["A", "B", "C"], ["A", "C"])).toEqual({ parts: ["same", "same"], removed: [1] });
    expect(comparePostParts(["A", "C"], ["A", "B", "C"])).toEqual({ parts: ["same", "new", "same"], removed: [] });
    expect(comparePostParts(["A", "B"], ["B", "A"]).parts.filter((change) => change === "same")).toHaveLength(1);
  });
});

describe("destinations", () => {
  it("reads a to: link, named or bare, and only takes web links", () => {
    expect(
      parseDraftBlock("title: Note\nto: [#ws-bc-coding thread](<https://x.slack.com/archives/C1/p17>)\n---\nHi"),
    ).toEqual({
      title: "Note",
      destination: { url: "https://x.slack.com/archives/C1/p17", label: "#ws-bc-coding thread" },
      body: "Hi",
      attachments: [],
    });
    expect(parseDestination("https://github.com/org/repo/pull/12 (review thread)")).toEqual({
      url: "https://github.com/org/repo/pull/12",
      label: "review thread",
    });
    expect(parseDestination("javascript:alert(1)")).toBeNull();
    expect(parseDestination("#ws-bc-coding")).toBeNull();
  });

  it("names a destination from its link when the draft gives no name", () => {
    expect(destinationLabel({ url: "https://x.slack.com/archives/C1/p1793138032493319" })).toBe("Slack thread");
    expect(destinationLabel({ url: "https://x.slack.com/archives/C1" })).toBe("Slack channel");
    expect(destinationLabel({ url: "https://github.com/org/takode/pull/42" })).toBe("PR #42 in takode");
    expect(destinationLabel({ url: "https://www.example.com/a" })).toBe("example.com");
    expect(destinationLabel({ url: "https://x.slack.com/archives/C1", label: "#ws-bc-coding" })).toBe("#ws-bc-coding");
  });
});

describe("posts in Markdown", () => {
  it("gathers a post's blocks into one card where its first block was, and keeps the text between", () => {
    const text = [
      "Here's the update:",
      "```draft\ntitle: T7 status\n---\nMessage\n```",
      "Reply:",
      "```draft\nReply one\nattach: /tmp/plot.png\n```",
      "```draft\ntitle: Other\n---\nAlternative\n```",
    ].join("\n\n");
    const grouped = groupDraftPostsInMarkdown(text);
    const posts = [...grouped.matchAll(/```takode-post\n(.*)\n```/g)].map((match) => parseGroupedDraftPost(match[1]!));
    expect(posts.map((post) => [post?.title, post?.blocks.map((block) => block.body)])).toEqual([
      ["T7 status", ["Message", "Reply one"]],
      ["Other", ["Alternative"]],
    ]);
    expect(posts[0]?.blocks[1]?.attachments).toEqual(["/tmp/plot.png"]);
    expect(grouped.indexOf("Here's the update")).toBeLessThan(grouped.indexOf("takode-post"));
    expect(grouped).toContain("Reply:");
    expect(grouped).not.toContain("```draft");
    expect(draftAttachmentPaths(text)).toEqual(new Set(["/tmp/plot.png"]));
    expect(groupDraftPostsInMarkdown("No drafts here")).toBe("No drafts here");
  });
});

describe("writing a post back as draft blocks", () => {
  it("reads back as the same post: parts, attachments and destination, code and header-like text intact", () => {
    // A shared draft is stored as the blocks formatDraftPost writes, so reading them back must give
    // the version it was written from. Every block carries the title: a part that starts with
    // header-like lines or holds a code fence must stay text of that same part.
    const post = {
      title: "T7 eval start",
      parts: ["Evals start at `iter 2`:\n```\nEval  Start\n```", "part: 3\n---\nlooks like a header", "Last reply"],
      attachments: [["/tmp/plot.png"], [], ["/tmp/a b.png", "/tmp/c.txt"]],
      destination: { url: "https://example.slack.com/archives/C1/p123", label: "#t7 thread" },
    };
    const text = formatDraftPost(post);
    const grouped = parseGroupedDraftPost(/```takode-post\n(.+)\n```/.exec(groupDraftPostsInMarkdown(text))![1]);
    expect(grouped?.title).toBe(post.title);
    expect(grouped?.blocks.map((block) => block.body)).toEqual(post.parts);
    expect(grouped?.blocks.map((block) => block.attachments)).toEqual(post.attachments);
    expect(grouped?.blocks[0].destination).toEqual(post.destination);
    expect(grouped?.blocks.some((block) => block.part)).toBe(false);
  });
});

describe("Slack's own syntax in drafts", () => {
  it("rewrites <url|name> links as Markdown links, leaving bare links and code alone", () => {
    // Slack's API form reaches drafts from agents that know it; Markdown would read the name as part of
    // the address. Code shows the syntax literally, so it is never rewritten.
    const text = [
      "See <https://github.com/o/r/tree/jiayi/fv|jiayi/fv> and <mailto:a@b.co|mail [us]> or <https://x.dev>.",
      "Write it as `<https://a.dev|a>` in code.",
      "```",
      "<https://b.dev|b>",
      "```",
    ].join("\n");
    expect(draftMarkdown(text)).toBe(
      [
        "See [jiayi/fv](<https://github.com/o/r/tree/jiayi/fv>) and [mail \\[us\\]](<mailto:a@b.co>) or <https://x.dev>.",
        "Write it as `<https://a.dev|a>` in code.",
        "```",
        "<https://b.dev|b>",
        "```",
      ].join("\n"),
    );
    expect(draftMarkdown("No links | here")).toBe("No links | here");
  });

  it("finds Slack mention tokens outside code, once each", () => {
    const text =
      "Hi <@U09FAJKF4H0> and <@W12AB|Ana>, in <#C01ABC> <!here> <!subteam^S12AB|@evals> <@U09FAJKF4H0> `<!channel>`";
    expect(slackNativeMentionTokens(text)).toEqual([
      "<@U09FAJKF4H0>",
      "<@W12AB|Ana>",
      "<#C01ABC>",
      "<!here>",
      "<!subteam^S12AB|@evals>",
    ]);
    expect(slackNativeMentionTokens("Email <a@b.co> or @Ana Lee")).toEqual([]);
  });
});

describe("bullet characters in drafts", () => {
  // Agents copy Slack's API text, which shows lists as "•" lines. Pasted, those stay plain-text lines that
  // wrap under the bullet, so a draft's bullet lines become a Markdown list, which the card's Copy turns into
  // an HTML list Slack keeps as its own.
  it("turns a run of bullet lines into a list, ending it before the next line", () => {
    const text = ["Some findings:", "• A 32 MB response: 20.3s to 0.06s", "• Fixes `42` lines", "Thanks!"].join("\n");
    expect(draftMarkdown(text)).toBe(
      ["Some findings:", "- A 32 MB response: 20.3s to 0.06s", "- Fixes `42` lines", "", "Thanks!"].join("\n"),
    );
  });

  it("nests by Slack's level bullets or by indentation, one level at a time", () => {
    // Slack's API writes levels as •, ◦ and ▪; agents often indent instead. A jump of two levels nests one.
    const text = ["• Top", "    ◦ Second", "        ▪ Third", "• Next", "  • Indented", "• Last", "▪ Jump"].join("\n");
    expect(draftMarkdown(text)).toBe(
      ["- Top", "  - Second", "    - Third", "- Next", "  - Indented", "- Last", "  - Jump"].join("\n"),
    );
  });

  it("leaves bullets inside code and in the middle of a line alone", () => {
    const text = ["Status • fine", "```", "• in a block", "```", "• Real item"].join("\n");
    expect(draftMarkdown(text)).toBe(["Status • fine", "```", "• in a block", "```", "- Real item"].join("\n"));
    // An unclosed fence is code to the end, as it renders.
    expect(draftMarkdown("```\n• still code")).toBe("```\n• still code");
  });
});
