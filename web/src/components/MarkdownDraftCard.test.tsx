// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";
import { messageCopyForSlack } from "../utils/slack-copy.js";

// Agents used to quote drafts, so a copy pasted into Slack as a quote or italics. A ```draft block shows
// the draft as the message it will become, and its button copies exactly the draft for Slack.
const MESSAGE = [
  "Here's a draft for the T7 thread:",
  "",
  "```draft",
  "Quick update on **T7**:",
  "- training is _healthy_",
  "- evals start at `iter 2`",
  "```",
  "",
  "Say if you want it shorter.",
].join("\n");

const written: Array<Record<string, string>> = [];
const originalClipboardItem = globalThis.ClipboardItem;

beforeEach(() => {
  written.length = 0;
  (globalThis as any).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
      write: vi.fn(async ([item]: Array<{ items: Record<string, Blob> }>) => {
        const out: Record<string, string> = {};
        for (const [type, blob] of Object.entries(item!.items)) out[type] = await blob.text();
        written.push(out);
      }),
    },
  });
});

afterEach(() => {
  (globalThis as any).ClipboardItem = originalClipboardItem;
});

describe("draft card", () => {
  it("shows the draft formatted, not as a code block", () => {
    const { container } = render(<MarkdownContent text={MESSAGE} />);
    const card = container.querySelector("[data-markdown-draft]")!;
    expect(card).not.toBeNull();
    expect(card.querySelector("strong")).toHaveTextContent("T7");
    expect(card.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("copies exactly the draft for Slack: formatting kept, nothing around it", async () => {
    render(<MarkdownContent text={MESSAGE} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/html"]).toBe(
      "<p>Quick update on <b>T7</b>:</p><ul><li>training is <i>healthy</i></li><li>evals start at <code>iter 2</code></li></ul>",
    );
    expect(written[0]!["text/plain"]).not.toMatch(/Here's a draft|shorter|Draft|Copy/);
  });

  it("joins a whole-message copy as content, without the card's header", () => {
    const { container } = render(<MarkdownContent text={MESSAGE} />);
    const html = messageCopyForSlack(container).html!;
    expect(html).toContain("<p>Here's a draft for the T7 thread:</p>");
    expect(html).toContain("Quick update on <b>T7</b>:");
    expect(html).not.toMatch(/>Copy<|>Draft</);
  });

  it("turns Slack's own <url|name> links into real links, so the pasted link opens the page", async () => {
    // An agent wrote a link the way Slack's API does; Markdown read the whole `<url|name>` as one
    // address, so the pasted link went to `.../tree/jiayi/fv-harder-tasks|jiayi/fv-harder-tasks` and 404'd.
    const url = "https://github.com/org/repo/tree/jiayi/fv-harder-tasks";
    const text = ["```draft", `Branch: <${url}|jiayi/fv-harder-tasks>, docs <https://example.com/docs>`, "```"].join(
      "\n",
    );
    render(<MarkdownContent text={text} />);
    const link = screen.getByRole("link", { name: "jiayi/fv-harder-tasks" });
    expect(link).toHaveAttribute("href", url);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/html"]).toBe(
      `<p>Branch: <a href="${url}">jiayi/fv-harder-tasks</a>, docs <a href="https://example.com/docs">https://example.com/docs</a></p>`,
    );
  });

  it("warns that Slack's own mention tokens won't become mentions, outside what is copied", async () => {
    // `<@U…>` and `<!here>` only work through Slack's API; pasted, they stay text. The warning sits on
    // the card but is never part of the copy.
    const text = ["```draft", "Thanks <@U09FAJKF4H0>, see <#C01ABCDEF|eval-runs> <!here>", "```"].join("\n");
    render(<MarkdownContent text={text} />);
    const warning = screen.getByTestId("draft-post-mention-warning");
    expect(warning).toHaveTextContent("<@U09FAJKF4H0>");
    expect(warning).toHaveTextContent("<#C01ABCDEF|eval-runs>");
    expect(warning).toHaveTextContent("<!here>");
    expect(warning).toHaveTextContent("Write @Full Name instead.");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/plain"]).not.toContain("Full Name");
  });
});
