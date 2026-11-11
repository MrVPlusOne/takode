import { Hono } from "hono";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTranscriptionRoutes } from "./routes/transcription.js";
import type { RouteContext } from "./routes/context.js";
import { _setTranscriptionRecordingRootForTest } from "./transcription-recordings.js";
import { _resetTranscriptionLogForTest } from "./transcription-enhancer.js";
import * as settingsManager from "./settings-manager.js";

vi.mock("./settings-manager.js", () => ({ getSettings: vi.fn(), GPT_TRANSCRIBE_STT_MODEL: "gpt-transcribe" }));
vi.mock("./session-names.js", () => ({ getName: vi.fn(), getAllNames: () => ({}) }));
let app: Hono;
let recordingRoot: string;
/** The dictating session's history; comment voice input now reads its conversation too. */
let history: unknown[] = [];
function mockVoiceSettings(overrides: Record<string, unknown> = {}) {
  vi.mocked(settingsManager.getSettings).mockReturnValue({
    transcriptionConfig: {
      apiKey: "fixture-key",
      baseUrl: "https://example.test/v1",
      sttModel: "gpt-transcribe",
      enhancementEnabled: true,
      enhancementModel: "fixture-model",
      ...overrides,
    },
    namerConfig: { backend: "claude" },
  } as ReturnType<typeof settingsManager.getSettings>);
}
beforeEach(async () => {
  vi.clearAllMocks();
  history = [];
  recordingRoot = await mkdtemp(join(tmpdir(), "annotation-transcription-recordings-"));
  _setTranscriptionRecordingRootForTest(recordingRoot);
  _resetTranscriptionLogForTest();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Unmocked provider request"))),
  );
  app = new Hono();
  app.route(
    "/api",
    createTranscriptionRoutes({
      launcher: { listSessions: () => [], getSession: () => undefined },
      wsBridge: { getSession: () => ({ messageHistory: history, taskHistory: [] }), broadcastToSession: vi.fn() },
    } as unknown as RouteContext),
  );
});
afterEach(async () => {
  _setTranscriptionRecordingRootForTest(null);
  await rm(recordingRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("annotation transcription requests", () => {
  it.each([
    "gpt-transcribe",
    "custom-compatible-stt",
  ])("sends annotation recognition context with %s capability fields", async (sttModel) => {
    // Real route/request construction, mocked fetch, and the suite's isolated recording root: no provider calls.
    mockVoiceSettings({ sttModel, enhancementEnabled: false, customVocabulary: "CacheTerm", sttLanguageHints: ["en"] });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: "What happens on expiry?" })));
    const context = {
      activeId: "active",
      selectedText: "cache expiry",
      mainComposerText: "Keep this as discussion",
      otherAnnotations: [{ id: "other", selectedText: "refresh", comment: "Does refresh retry?" }],
    };
    const form = new FormData();
    form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    form.append("annotationContext", JSON.stringify(context));
    form.append("composerText", "");
    const res = await app.request("/api/transcribe", { method: "POST", body: form });
    await res.text();
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(fetch).mock.calls[0][1]!.body as FormData;
    expect(String(sent.get("prompt"))).toContain("Does refresh retry?");
    expect(String(sent.get("prompt"))).toContain("Keep this as discussion");
    expect(sent.getAll("keywords[]")).toEqual(sttModel === "gpt-transcribe" ? ["CacheTerm"] : []);
    expect(sent.getAll("languages[]")).toEqual(sttModel === "gpt-transcribe" ? ["en"] : []);
    expect(sent.has("language")).toBe(false);
  });

  it.each(["append", "edit"])("keeps the annotation %s target separate from surrounding comments", async (mode) => {
    mockVoiceSettings({ sttModel: "gpt-transcribe" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Mention retry behavior" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Updated comment" }, finish_reason: "stop" }] })),
      );
    const form = new FormData();
    form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    form.append("mode", mode);
    form.append("composerText", "Only this comment can change");
    form.append(
      "annotationContext",
      JSON.stringify({
        activeId: "active",
        selectedText: "cache",
        mainComposerText: "Main stays unchanged",
        otherAnnotations: [],
      }),
    );
    const res = await app.request("/api/transcribe", { method: "POST", body: form });
    expect(await res.text()).toContain("Updated comment");
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]!.body));
    const input: string = request.messages[1].content;
    // The comment is the editable target, the operation rides on the speech, and the main draft is read-only context.
    expect(input).toContain("<CURRENT_COMMENT>\nOnly this comment can change\n</CURRENT_COMMENT>");
    expect(input).toContain(`<TRANSCRIPT operation="${mode}" format="default">\nMention retry behavior\n</TRANSCRIPT>`);
    expect(input).toContain("<MAIN_COMPOSER_TEXT>\nMain stays unchanged\n</MAIN_COMPOSER_TEXT>");
    expect(input.indexOf("<MAIN_COMPOSER_TEXT>")).toBeLessThan(input.indexOf("<CURRENT_COMMENT>"));
    expect(request.messages[0].content).toContain("<CURRENT_COMMENT> is the only editable text");
  });

  it("gives comment voice input the conversation the comment is in", async () => {
    // Comments used to get no conversation at all, so names said earlier in it could not be recognized.
    history = [
      { type: "user_message", content: "Where do the retrofit jobs run?", timestamp: 1 },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "They run on Qingyu's shared pool at mid priority." }] },
        timestamp: 2,
      },
    ];
    mockVoiceSettings({ sttModel: "gpt-transcribe" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Use the shared fleet from Chengyu's" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Use Qingyu's fleet" }, finish_reason: "stop" }] }),
        ),
      );
    const form = new FormData();
    form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    form.append(
      "annotationContext",
      JSON.stringify({ activeId: "active", selectedText: "queued jobs", mainComposerText: "", otherAnnotations: [] }),
    );
    const res = await app.request("/api/transcribe", { method: "POST", body: form });
    expect(await res.text()).toContain("Use Qingyu's fleet");
    const sttForm = vi.mocked(fetch).mock.calls[0][1]!.body as FormData;
    expect(String(sttForm.get("prompt"))).toContain("Qingyu's shared pool");
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]!.body));
    expect(request.messages[1].content).toMatch(
      /<CONVERSATION_CONTEXT>[\s\S]*Qingyu's shared pool[\s\S]*<COMMENTED_TEXT>/,
    );
  });

  it("rejects incomplete annotation edit output instead of returning a partial replacement", async () => {
    mockVoiceSettings({ sttModel: "gpt-transcribe" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Expand this comment" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "TRUNCATED_REPLACEMENT" }, finish_reason: "length" }] }),
        ),
      );
    const form = new FormData();
    form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    form.append("mode", "edit");
    form.append("composerText", "Original comment");
    form.append(
      "annotationContext",
      JSON.stringify({ activeId: "active", selectedText: "cache", mainComposerText: "", otherAnnotations: [] }),
    );
    const res = await app.request("/api/transcribe", { method: "POST", body: form });
    const body = await res.text();
    expect(body).toContain("Voice edit did not finish");
    expect(body).not.toContain('"text":"TRUNCATED_REPLACEMENT"');
  });

  it("passes comment context to Gemini's existing audio/text request", async () => {
    mockVoiceSettings({ enhancementEnabled: false });
    vi.stubEnv("GOOGLE_API_KEY", "fixture-key");
    try {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Spoken comment" }] } }] })),
      );
      const form = new FormData();
      form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
      form.append("backend", "gemini");
      form.append("sessionId", "session-1");
      form.append(
        "annotationContext",
        JSON.stringify({
          activeId: "active",
          selectedText: "CacheTerm",
          mainComposerText: "Read-only main",
          otherAnnotations: [],
        }),
      );
      const res = await app.request("/api/transcribe", { method: "POST", body: form });
      expect(await res.text()).toContain("Spoken comment");
      const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
      expect(request.contents[0].parts[1].text).toContain("Read-only main");
      expect(request.contents[0].parts[0]).toHaveProperty("inline_data");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
