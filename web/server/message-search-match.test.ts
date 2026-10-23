import { describe, expect, it } from "vitest";
import { prepareSearchQuery } from "../shared/search-utils.js";
import { buildMessageSnippet, matchMessageText, userWrittenText } from "./message-search-match.js";

const strength = (text: string, query: string) => matchMessageText(text, prepareSearchQuery(query)!)?.strength ?? null;

describe("matchMessageText", () => {
  it("grades a match by whole words and whether they sit together in query order", () => {
    // Message search orders by this grade before recency, so a phrase beats the same words
    // scattered through a message, and both beat a word that is still being typed.
    expect(strength("audit the network traffic from the past days", "network traffic")).toBe(0);
    expect(strength("save traffic. When I'm commuting, the network can be bad", "network traffic")).toBe(1);
    expect(strength("audit the network traffic", "network traf")).toBe(2);
    expect(strength("save traffic, the network is slow", "network traf")).toBe(3);
    expect(strength("network only", "network traffic")).toBeNull();
  });

  it("counts a phrase with one word between neighbours as together, but not two", () => {
    // "restart server" should find "restart the server" as the phrase the user means.
    expect(strength("Should I restart the server now?", "restart server")).toBe(0);
    expect(strength("restart then the server", "restart server")).toBe(1);
    // Order matters: the words reversed are apart, not together.
    expect(strength("server restart", "restart server")).toBe(1);
  });

  it("finds a run that a greedy earliest choice would miss", () => {
    // After "a", the earliest "b" cannot reach "c" (two words between); the next "b" can.
    expect(strength("a b b x c", "a b c")).toBe(0);
  });

  it("ignores case and punctuation between words, and treats a one-word query as whole word or prefix", () => {
    expect(strength('the exact phrase, "Network, Traffic," here', "network traffic")).toBe(0);
    expect(strength("my phone is slow", "phone")).toBe(0);
    expect(strength("my phones are slow", "phone")).toBe(2);
  });
});

describe("buildMessageSnippet", () => {
  it("centers on the phrase rather than an earlier lone word", () => {
    // The first "network" is far from any "traffic"; the snippet should show the phrase.
    const text = `network ${"filler ".repeat(40)}and then the network traffic doubled`;
    const snippet = buildMessageSnippet(text, prepareSearchQuery("network traffic"));
    expect(snippet.snippet).toContain("network traffic doubled");
    expect(snippet.matchedText).toBe("network traffic");
    const highlighted = snippet.matchRanges.map((range) => snippet.snippet.slice(range.start, range.end));
    expect(highlighted).toEqual(["network", "traffic"]);
  });

  it("returns the leading text when there is no query", () => {
    expect(buildMessageSnippet("  hello   world ", null)).toEqual({
      snippet: "hello world",
      matchRanges: [],
    });
  });
});

describe("userWrittenText", () => {
  it("joins the message text and the user's comments, leaving out the quoted text", () => {
    const annotations = [
      {
        id: "a1",
        selectedText: "quoted assistant words",
        comment: "my first comment",
      },
      {
        id: "a2",
        selectedText: "more quoted words",
        comment: "my second comment",
      },
    ];
    expect(userWrittenText("", annotations)).toBe("my first comment\n\nmy second comment");
    expect(userWrittenText("message text", annotations)).toBe("message text\n\nmy first comment\n\nmy second comment");
    expect(userWrittenText("message text", undefined)).toBe("message text");
  });
});
