import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  DEFAULT_READ_ALOUD_SETTINGS,
  buildReadAloudContext,
  readAloudKeptOriginal,
  runReadAloud,
  splitTextForSpeech,
} from "./read-aloud.js";

function user(id: string, content: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content,
    timestamp: 1,
    ...(threadKey ? { threadKey } : {}),
  } as BrowserIncomingMessage;
}

function assistant(id: string, text: string, threadKey?: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 2,
    ...(threadKey ? { threadKey } : {}),
  } as BrowserIncomingMessage;
}

/** A fake OpenAI: chat completions answer with `rewrite`; speech returns one second of PCM silence per piece. */
function mockOpenAI(rewrite: string, finishReason = "stop") {
  const speechInputs: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/chat/completions")) {
      return Response.json({ choices: [{ message: { content: rewrite }, finish_reason: finishReason }] });
    }
    speechInputs.push(body.input);
    return new Response(new Uint8Array(24_000 * 2));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, speechInputs };
}

const config = { apiKey: "test-key", baseUrl: "https://api.example.test/v1/" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitTextForSpeech", () => {
  it("packs whole sentences into pieces of about 350 characters", () => {
    // Small pieces run in parallel; ending each at a sentence keeps the pauses natural.
    const sentence = `${"word ".repeat(20).trim()}.`; // 100 characters
    const paragraph = [sentence, sentence, sentence, sentence, sentence].join(" ");
    const chunks = splitTextForSpeech(`${paragraph}\n\n${sentence}`);
    expect(chunks).toEqual([
      [sentence, sentence, sentence].join(" "),
      `${[sentence, sentence].join(" ")}\n\n${sentence}`,
    ]);
  });

  it("splits Chinese text at its full stops", () => {
    const sentence = `${"字".repeat(200)}。`;
    expect(splitTextForSpeech(sentence + sentence)).toEqual([sentence, sentence]);
  });

  it("splits a paragraph over the 4,096-character request limit at sentences, then hard", () => {
    const sentence = `${"a".repeat(1500)}.`;
    const chunks = splitTextForSpeech(`${sentence} ${sentence} ${sentence} ${"b".repeat(5000)}`);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join("").replace(/\s/g, "")).toBe(`${sentence}${sentence}${sentence}${"b".repeat(5000)}`);
  });

  it("drops empty paragraphs and collapses whitespace", () => {
    expect(splitTextForSpeech("\n\nHello   there.\n\n\n\n  \n\nBye.")).toEqual(["Hello there.\n\nBye."]);
  });
});

describe("buildReadAloudContext", () => {
  it("uses only the conversation before the message", () => {
    const history = [
      user("u1", "Can you fix the overlapping timer?"),
      assistant("a1", "Fixed the timer."),
      user("u2", "Thanks, now the sidebar."),
      assistant("a2", "Sidebar done."),
    ];
    const context = buildReadAloudContext(history, "a1", 1);
    expect(context).toContain("Can you fix the overlapping timer?");
    expect(context).not.toContain("Fixed the timer.");
    expect(context).not.toContain("sidebar");
  });

  it("keeps a leader quest-thread message to its own thread", () => {
    // Leader sessions interleave threads; another thread's messages would only confuse the rewrite.
    const history = [
      user("u1", "Main thread question", "main"),
      user("u2", "Quest thread question", "q-7"),
      assistant("a-main", "Main answer", "main"),
      assistant("a-quest", "Quest answer", "q-7"),
    ];
    const context = buildReadAloudContext(history, "a-quest", 3);
    expect(context).toContain("Quest thread question");
    expect(context).not.toContain("Main thread question");
  });

  it("falls back to the latest conversation when the message is not in the history", () => {
    const history = [user("u1", "Recent question"), assistant("a1", "Recent answer")];
    expect(buildReadAloudContext(history, "missing")).toContain("Recent question");
  });
});

describe("runReadAloud", () => {
  it("speaks the rewrite in pieces, encoding them into one compressed MP3", async () => {
    const paragraph = `${"word ".repeat(60).trim()}.`; // 300 characters
    const rewrite = `${paragraph}\n\n${paragraph}\n\nThe end.`;
    const { fetchMock, speechInputs } = mockOpenAI(rewrite);

    const result = await runReadAloud({ messageText: "**Raw** text", conversationContext: "ctx" }, config);

    expect(result.error).toBeNull();
    expect(speechInputs).toEqual([paragraph, `${paragraph}\n\nThe end.`]);
    // Two seconds of 24 kHz PCM, joined and encoded as one 48 kbps MP3 (6 KB a second).
    const audio = result.audio!;
    expect(audio[0]).toBe(0xff);
    expect(audio[1] & 0xe0).toBe(0xe0);
    expect(audio.length).toBeGreaterThan(10_000);
    expect(audio.length).toBeLessThan(14_000);
    const speechBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(speechBody).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", response_format: "pcm" });
    const [rewriteUrl, rewriteInit] = fetchMock.mock.calls[0];
    expect(rewriteUrl).toBe("https://api.example.test/v1/chat/completions");
    const rewriteBody = JSON.parse(String(rewriteInit.body));
    expect(rewriteBody.model).toBe("gpt-5.5");
    expect(rewriteBody.messages[0].content).toBe(DEFAULT_READ_ALOUD_SETTINGS.rewriteSystemPrompt);
    // The trace keeps the exact prompts for the debug panel.
    expect(rewriteBody.messages[1].content).toBe(result.trace.rewriteUserPrompt);
    expect(result.trace.rewriteUserPrompt).toBe(
      "<CONVERSATION_CONTEXT>\nctx\n</CONVERSATION_CONTEXT>\n\n<MESSAGE>\n**Raw** text\n</MESSAGE>",
    );
    expect(result.trace).toMatchObject({ rewriteOutput: rewrite, spokenText: rewrite, speechParts: 2 });
  });

  it("speaks the original text when the model says no rewrite is needed", async () => {
    const { speechInputs } = mockOpenAI("UNCHANGED");
    const result = await runReadAloud({ messageText: "Done. It works now.", conversationContext: "" }, config);
    expect(readAloudKeptOriginal(result.trace)).toBe(true);
    expect(speechInputs).toEqual(["Done. It works now."]);
  });

  it("uses the given voice and style, and skips the rewrite when its prompt is null", async () => {
    const { fetchMock } = mockOpenAI("unused");
    await runReadAloud({ messageText: "Hi there.", conversationContext: "" }, config, {
      ...DEFAULT_READ_ALOUD_SETTINGS,
      rewriteSystemPrompt: null,
      voice: "cedar",
      voiceStyle: "Speak quickly.",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://api.example.test/v1/audio/speech"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      voice: "cedar",
      instructions: "Speak quickly.",
      input: "Hi there.",
    });
  });

  it("does not read a rewrite that was cut off", async () => {
    mockOpenAI("Half a sentence", "length");
    const result = await runReadAloud({ messageText: "Hi", conversationContext: "" }, config);
    expect(result.audio).toBeNull();
    expect(result.error).toContain("stopped before finishing");
  });

  it("reports provider errors with their status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );
    const result = await runReadAloud({ messageText: "Hi", conversationContext: "" }, config);
    expect(result.error).toBe("OpenAI /chat/completions failed with 429: quota exceeded");
  });
});
