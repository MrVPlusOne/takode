import { describe, expect, it } from "vitest";
import {
  comparePostParts,
  draftAttachmentPaths,
  groupDraftPostsInMarkdown,
  parseDraftBlock,
  parseGroupedDraftPost,
  revisePostParts,
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
