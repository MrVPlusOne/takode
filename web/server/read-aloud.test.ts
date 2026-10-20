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

/**
 * A fake OpenAI: chat completions stream `rewrite` in 20-character deltas, waiting for
 * `holdAfter` (when given) once that many characters are out; speech returns one second
 * of PCM silence. Each piece is requested twice (hedging), so `speechInputs` lists
 * each distinct piece once.
 */
function mockOpenAI(rewrite: string, finishReason = "stop", holdAfter?: { chars: number; until: Promise<void> }) {
  const speechInputs: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/chat/completions")) return sseResponse(rewrite, finishReason, holdAfter);
    if (!speechInputs.includes(body.input)) speechInputs.push(body.input);
    return new Response(new Uint8Array(24_000 * 2));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, speechInputs };
}

function sseResponse(text: string, finishReason: string, holdAfter?: { chars: number; until: Promise<void> }) {
  const encoder = new TextEncoder();
  const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < text.length; i += 20) {
        if (holdAfter && i >= holdAfter.chars && i - 20 < holdAfter.chars) await holdAfter.until;
        controller.enqueue(event({ choices: [{ delta: { content: text.slice(i, i + 20) }, finish_reason: null }] }));
      }
      controller.enqueue(event({ choices: [{ delta: {}, finish_reason: finishReason }] }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** The speech endpoint (gpt-4o-mini-tts), which these tests fake through fetch. */
const ENDPOINT = { ...DEFAULT_READ_ALOUD_SETTINGS, ttsModel: "gpt-4o-mini-tts" };

const config = { apiKey: "test-key", baseUrl: "https://api.example.test/v1/" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitTextForSpeech", () => {
  it("prefers a blank line, then a line break, then a sentence end, the latest that fits", () => {
    const line = "word ".repeat(30).trim(); // 149 characters
    // A blank line (at 300) beats a later line break (at 450) or sentence end.
    expect(splitTextForSpeech(`${line}\n${line}\n\n${line}\n${line}. ${line}`, 500)[0]).toBe(`${line}\n${line}`);
    // Without a blank line, the latest line break that fits.
    expect(splitTextForSpeech(`${line}\n${line}\n${line}\n${line}`, 500)[0]).toBe(`${line}\n${line}\n${line}`);
    // A break that would leave the piece under half full is passed over for a lesser, later one.
    expect(splitTextForSpeech(`${line}\n\n${line}. ${line}. ${line}`, 500)[0]).toBe(`${line}\n\n${line}. ${line}.`);
  });

  it("falls back to sentence ends, English or Chinese, then spaces, then a plain cut", () => {
    const sentence = `${"word ".repeat(20).trim()}.`; // 100 characters
    expect(splitTextForSpeech(`${sentence} ${sentence} ${sentence}`, 250)).toEqual([
      `${sentence} ${sentence}`,
      sentence,
    ]);
    const chinese = `${"字".repeat(99)}。`;
    expect(splitTextForSpeech(chinese.repeat(3), 250)).toEqual([chinese.repeat(2), chinese]);
    expect(splitTextForSpeech("word ".repeat(100).trim(), 250)[0]).toBe("word ".repeat(50).trim());
    expect(splitTextForSpeech("x".repeat(600), 250)).toEqual(["x".repeat(250), "x".repeat(250), "x".repeat(100)]);
  });

  it("never goes past the 4,096-character request limit", () => {
    const chunks = splitTextForSpeech("a ".repeat(5000), 10_000);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join(" ").length).toBe("a ".repeat(5000).trim().length);
  });

  it("drops empty lines and extra spaces", () => {
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

  it("finds a published report and uses the conversation before it in its thread", () => {
    const report = {
      type: "markdown_report",
      id: "report-1",
      timestamp: 3,
      content: "# Findings",
      source: { sessionId: "s1", reportId: "r1", sourcePath: "/tmp/report.md", sha256: "x" },
      threadKey: "q-7",
    } as BrowserIncomingMessage;
    const history = [
      user("u1", "Main question", "main"),
      user("u2", "Please write the report", "q-7"),
      report,
      user("u3", "Thanks for the report", "q-7"),
    ];
    const context = buildReadAloudContext(history, "report-1");
    expect(context).toContain("Please write the report");
    expect(context).not.toContain("Main question");
    expect(context).not.toContain("Thanks for the report");
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

    const result = await runReadAloud({ messageText: "**Raw** text", conversationContext: "ctx" }, config, ENDPOINT);

    expect(result.error).toBeNull();
    expect(speechInputs).toEqual([paragraph, `${paragraph}\n\nThe end.`]);
    // Two seconds of 24 kHz PCM, joined and encoded as one 48 kbps MP3 (6 KB a second).
    const audio = result.audio!;
    expect(audio[0]).toBe(0xff);
    expect(audio[1] & 0xe0).toBe(0xe0);
    expect(audio.length).toBeGreaterThan(10_000);
    expect(audio.length).toBeLessThan(14_000);
    const speechBody = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.endsWith("/audio/speech"))![1].body));
    expect(speechBody).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", response_format: "pcm" });
    const [rewriteUrl, rewriteInit] = fetchMock.mock.calls[0];
    expect(rewriteUrl).toBe("https://api.example.test/v1/chat/completions");
    const rewriteBody = JSON.parse(String(rewriteInit.body));
    expect(rewriteBody).toMatchObject({ model: "gpt-5.5", stream: true, reasoning_effort: "none" });
    expect(rewriteBody.messages[0].content).toBe(DEFAULT_READ_ALOUD_SETTINGS.rewriteSystemPrompt);
    // The trace keeps the exact prompts for the debug panel.
    expect(rewriteBody.messages[1].content).toBe(result.trace.rewriteUserPrompt);
    expect(result.trace.rewriteUserPrompt).toBe(
      "<CONVERSATION_CONTEXT>\nctx\n</CONVERSATION_CONTEXT>\n\n<MESSAGE>\n**Raw** text\n</MESSAGE>",
    );
    expect(result.trace).toMatchObject({
      rewriteOutput: rewrite,
      spokenText: rewrite,
      speechParts: 2,
      speechRequests: 4,
    });
  });

  it("starts speaking the first piece while the rewrite is still streaming", async () => {
    // Four distinct sentences of about 250 characters; two fit in one 600-character piece.
    const [a, b, c, d] = ["alpha", "bravo", "charlie", "delta"].map(
      (word) => `${`${word} `.repeat(Math.floor(250 / (word.length + 1))).trim()}.`,
    );
    const rewrite = [a, b, c, d].join(" ");
    let release!: () => void;
    const until = new Promise<void>((resolve) => (release = resolve));
    const { speechInputs } = mockOpenAI(rewrite, "stop", { chars: 700, until });

    const run = runReadAloud({ messageText: "Stream me", conversationContext: "" }, config, ENDPOINT);
    // The first two sentences go to speech while the stream is held.
    await vi.waitFor(() => expect(speechInputs).toEqual([`${a} ${b}`]));
    release();
    const result = await run;
    expect(result.error).toBeNull();
    expect(speechInputs).toEqual([`${a} ${b}`, `${c} ${d}`]);
  });

  it("reuses the rewrite when the same message is read again", async () => {
    const { fetchMock } = mockOpenAI("Spoken once.");
    const input = { messageText: "Read me *twice*", conversationContext: "" };
    await runReadAloud(input, config, ENDPOINT);
    const second = await runReadAloud(input, config, { ...ENDPOINT, voice: "nova" });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/chat/completions"))).toHaveLength(1);
    expect(second.trace).toMatchObject({ rewriteCached: true, spokenText: "Spoken once.", rewriteMs: 0 });
  });

  it("speaks the original text when the model says no rewrite is needed", async () => {
    const { speechInputs } = mockOpenAI("UNCHANGED");
    const result = await runReadAloud(
      { messageText: "Done. It works now.", conversationContext: "" },
      config,
      ENDPOINT,
    );
    expect(result.error).toBeNull();
    expect(readAloudKeptOriginal(result.trace)).toBe(true);
    expect(speechInputs).toEqual(["Done. It works now."]);
  });

  it("uses the given voice and style, and skips the rewrite when its prompt is null", async () => {
    const { fetchMock } = mockOpenAI("unused");
    await runReadAloud({ messageText: "Hi there.", conversationContext: "" }, config, {
      ...ENDPOINT,
      rewriteSystemPrompt: null,
      voice: "cedar",
      voiceStyle: "Speak quickly.",
    });
    // No rewrite request; the one piece is requested twice to dodge a slow answer.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/v1/audio/speech",
      "https://api.example.test/v1/audio/speech",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      voice: "cedar",
      instructions: "Speak quickly.",
      input: "Hi there.",
    });
  });

  it("does not read a rewrite that was cut off", async () => {
    mockOpenAI("Half a sentence", "length");
    const result = await runReadAloud({ messageText: "Hi", conversationContext: "" }, config, ENDPOINT);
    expect(result.audio).toBeNull();
    expect(result.error).toContain("stopped before finishing");
  });

  it("reports provider errors with their status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );
    const result = await runReadAloud({ messageText: "Hi", conversationContext: "" }, config, ENDPOINT);
    expect(result.error).toBe("OpenAI /chat/completions failed with 429: quota exceeded");
  });

  it("reads through a Realtime model by default: one WebSocket per piece, audio only", async () => {
    // A fake Realtime server: answers each response.create with one second of PCM.
    const sockets: Array<{ url: string; sent: Array<Record<string, unknown>> }> = [];
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      private readonly record: { url: string; sent: Array<Record<string, unknown>> };
      constructor(url: string, options: { headers: Record<string, string> }) {
        expect(options.headers.Authorization).toBe("Bearer test-key");
        this.record = { url, sent: [] };
        sockets.push(this.record);
        queueMicrotask(() => this.onopen?.());
      }
      send(data: string) {
        const message = JSON.parse(data) as Record<string, unknown>;
        this.record.sent.push(message);
        if (message.type !== "response.create") return;
        const delta = Buffer.from(new Uint8Array(24_000 * 2)).toString("base64");
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ type: "response.output_audio.delta", delta }) });
          this.onmessage?.({ data: JSON.stringify({ type: "response.done", response: { status: "completed" } }) });
        });
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    mockOpenAI("UNCHANGED");

    const result = await runReadAloud({ messageText: "Short reply.", conversationContext: "" }, config);

    expect(result.error).toBeNull();
    expect(result.trace.speechRequests).toBe(1);
    expect(sockets.map((socket) => socket.url)).toEqual([
      "wss://api.example.test/v1/realtime?model=gpt-realtime-2.1-mini",
    ]);
    const [session, item] = sockets[0].sent;
    expect(session).toMatchObject({
      type: "session.update",
      session: { output_modalities: ["audio"], audio: { output: { voice: "marin" } } },
    });
    expect(item).toMatchObject({ item: { content: [{ type: "input_text", text: "Short reply." }] } });
    expect(result.audio!.length).toBeGreaterThan(5_000);
  });
});
