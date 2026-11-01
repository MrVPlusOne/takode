import type { Hono } from "hono";
import { replaceVisualFences, visualPlainText } from "../../shared/visual-block.js";
import { createHash } from "node:crypto";
import type { WsBridge } from "../ws-bridge.js";
import { getSettings } from "../settings-manager.js";
import { resolveOpenAIKey } from "../transcription.js";
import {
  DEFAULT_READ_ALOUD_SETTINGS,
  READ_ALOUD_SPEECH_MODELS,
  READ_ALOUD_VOICES,
  buildReadAloudContext,
  runReadAloud,
  type ReadAloudOpenAIConfig,
  type ReadAloudSettings,
} from "../read-aloud.js";
import { ReadAloudRecordStore } from "../read-aloud-records.js";
import { describeReadAloudLinks } from "../read-aloud-links.js";
import { mp3Seconds } from "../read-aloud-speech.js";
import {
  READ_ALOUD_STREAM_CONTENT_TYPE,
  encodeReadAloudFrame,
  type ReadAloudStreamFrame,
} from "../../shared/read-aloud-stream.js";

const MAX_MESSAGE_CHARS = 60_000;
const MAX_SETTING_CHARS = 20_000;
const MISSING_KEY_ERROR = "Add an OpenAI API key in Settings > Voice to use Read aloud";

export interface SessionReadAloudRouteDeps {
  wsBridge: WsBridge;
  resolveId: (idOrNum: string) => string | null;
  /** Replaceable in tests; default to the real OpenAI pipeline and record folder. */
  run?: typeof runReadAloud;
  records?: ReadAloudRecordStore;
  describeLinks?: typeof describeReadAloudLinks;
}

/**
 * Read aloud: POST /sessions/:id/read-aloud streams the MP3 audio of one assistant message piece by
 * piece as it is made (shared/read-aloud-stream.ts), so playback starts with the first piece.
 * The browser sends the text it shows (so merged or thread-prefixed messages read as
 * displayed); the server adds the conversation context and calls OpenAI with the
 * Voice key. For one slide of a deck being played, the browser also sends `slide`, what
 * the slide shows; the text is then the slide's narration, and the slide replaces the
 * conversation as the rewrite's context. Every read is recorded for the Read Aloud debug panel, whose
 * /read-aloud/records routes list, show and replay records with other settings. A
 * message read again with the same text and settings plays its recorded audio.
 */
export function registerSessionReadAloudRoute(api: Hono, deps: SessionReadAloudRouteDeps): void {
  const { wsBridge, resolveId, run = runReadAloud, describeLinks = describeReadAloudLinks } = deps;
  const records = deps.records ?? new ReadAloudRecordStore();

  const openAIConfig = (signal: AbortSignal): ReadAloudOpenAIConfig | null => {
    const apiKey = resolveOpenAIKey();
    if (!apiKey) return null;
    return { apiKey, baseUrl: getSettings().transcriptionConfig.baseUrl || "https://api.openai.com/v1", signal };
  };

  api.post("/sessions/:id/read-aloud", async (c) => {
    const sessionId = resolveId(c.req.param("id"));
    const session = sessionId ? wsBridge.getSession(sessionId) : null;
    if (!sessionId || !session) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const historyIndex = typeof body.historyIndex === "number" ? Math.floor(body.historyIndex) : undefined;
    if (!messageId || !text) return c.json({ error: "messageId and text are required" }, 400);
    const slide = readSlide(body.slide);
    if (slide === "invalid") return c.json({ error: "slide.shown must be a string" }, 400);
    if (text.length > MAX_MESSAGE_CHARS) return c.json({ error: "This message is too long to read aloud" }, 413);
    const voice = body.voice ?? DEFAULT_READ_ALOUD_SETTINGS.voice;
    const accepted = READ_ALOUD_SPEECH_MODELS.find((entry) => entry.model === DEFAULT_READ_ALOUD_SETTINGS.ttsModel);
    if (!accepted?.voices.includes(voice)) return c.json({ error: `Unknown voice: ${String(voice)}` }, 400);
    const config = openAIConfig(c.req.raw.signal);
    if (!config) return c.json({ error: MISSING_KEY_ERROR }, 400);

    const settings = { ...DEFAULT_READ_ALOUD_SETTINGS, voice };
    const cacheKey = createHash("sha256")
      .update(JSON.stringify([sessionId, messageId, text, settings, ...(slide ? [slide.shown] : [])]))
      .digest("hex");
    const cached = await records.findCached(cacheKey).catch((error) => {
      console.warn(`[read-aloud] Could not look up earlier audio: ${error}`);
      return null;
    });
    const cachedAudio = cached ? await records.readAudio(cached.id).catch(() => null) : null;
    if (cached && cachedAudio)
      return streamResponse(async (send) => {
        send({ type: "piece", mp3: cachedAudio, seconds: mp3Seconds(cachedAudio.length) });
        send({ type: "done", recordId: cached.id, cached: true });
      }, c.req.raw.signal);

    const conversationContext = slide ? "" : buildReadAloudContext(session.messageHistory, messageId, historyIndex);
    const linkDetails = await describeLinks(text);
    // A visual is heard as its plain-text version, never as its HTML.
    const plain = (markdown: string) =>
      replaceVisualFences(markdown, (block) => `(A visual on screen: ${visualPlainText(block)})`);
    const spokenSource = plain(text);
    // A slide without notes is narrated from its own text, which then needs no second copy.
    const onScreen = slide && slide.shown.trim() && slide.shown.trim() !== text ? plain(slide.shown) : undefined;
    // Pieces go to the browser as soon as each is spoken, so playback starts with the first.
    return streamResponse(async (send, signal) => {
      let sentPieces = 0;
      const result = await run(
        { messageText: spokenSource, conversationContext, linkDetails, ...(onScreen ? { onScreen } : {}) },
        { ...config, signal },
        settings,
        (segment) => {
          sentPieces++;
          send({ type: "piece", ...segment });
        },
      );
      const record = await records
        .create(
          {
            sessionId,
            messageId,
            messageText: text,
            conversationContext,
            linkDetails,
            ...(onScreen ? { onScreen } : {}),
            cacheKey,
            trace: result.trace,
            error: result.error,
          },
          result.audio,
        )
        .catch((error) => {
          console.warn(`[read-aloud] Could not save the debug record: ${error}`);
          return null;
        });
      if (!result.audio) {
        console.warn(`[read-aloud] Session ${sessionId.slice(0, 8)} failed: ${result.error}`);
        send({ type: "error", message: `Read aloud failed. ${result.error}` });
        return;
      }
      // A pipeline that only returns the whole audio (none today but test doubles) still plays.
      if (sentPieces === 0) send({ type: "piece", mp3: result.audio, seconds: mp3Seconds(result.audio.length) });
      send({ type: "done", recordId: record?.id ?? null, cached: false });
    }, c.req.raw.signal);
  });

  /** The browser's side of one playback: waiting, download and start times. */
  api.post("/read-aloud/records/:recordId/client-timing", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ms = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
    const timing = { waitMs: ms(body.waitMs), downloadMs: ms(body.downloadMs), startMs: ms(body.startMs) };
    if (timing.waitMs === null || timing.downloadMs === null || timing.startMs === null) {
      return c.json({ error: "waitMs, downloadMs and startMs must be non-negative numbers" }, 400);
    }
    const saved = await records.addClientTiming(c.req.param("recordId"), {
      at: Date.now(),
      waitMs: timing.waitMs,
      downloadMs: timing.downloadMs,
      startMs: timing.startMs,
      cached: body.cached === true,
    });
    return saved ? c.json({ ok: true }) : c.json({ error: "Record not found" }, 404);
  });

  api.get("/read-aloud/records", async (c) => {
    return c.json({ records: await records.listRecent() });
  });

  api.get("/read-aloud/records/:recordId", async (c) => {
    const record = await records.get(c.req.param("recordId"));
    if (!record) return c.json({ error: "Record not found" }, 404);
    const replays = (await Promise.all(record.replayIds.map((id) => records.get(id)))).filter((r) => r !== null);
    return c.json({
      record,
      replays,
      defaults: DEFAULT_READ_ALOUD_SETTINGS,
      voices: READ_ALOUD_VOICES,
      speechModels: READ_ALOUD_SPEECH_MODELS,
    });
  });

  api.get("/read-aloud/records/:recordId/audio", async (c) => {
    const audio = await records.readAudio(c.req.param("recordId"));
    if (!audio) return c.json({ error: "No audio for this record" }, 404);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
  });

  /** Read a recorded message again with other settings; the result is saved as a replay of it. */
  api.post("/read-aloud/records/:recordId/replay", async (c) => {
    const source = await records.get(c.req.param("recordId"));
    if (!source) return c.json({ error: "Record not found" }, 404);
    const settings = parseReplaySettings(await c.req.json().catch(() => ({})), source.trace.settings);
    if (typeof settings === "string") return c.json({ error: settings }, 400);
    const config = openAIConfig(c.req.raw.signal);
    if (!config) return c.json({ error: MISSING_KEY_ERROR }, 400);

    const input = {
      messageText: source.messageText,
      conversationContext: source.conversationContext,
      linkDetails: source.linkDetails,
      ...(source.onScreen ? { onScreen: source.onScreen } : {}),
    };
    const result = await run(input, config, settings);
    const record = await records.create(
      {
        ...input,
        sessionId: source.sessionId,
        messageId: source.messageId,
        sourceId: source.id,
        trace: result.trace,
        error: result.error,
      },
      result.audio,
    );
    return c.json({ record });
  });
}

/** A played slide: what it shows. Null when absent. */
function readSlide(value: unknown): { shown: string } | null | "invalid" {
  if (value === undefined) return null;
  const shown = (value as { shown?: unknown } | null)?.shown;
  if (typeof shown !== "string" || shown.length > MAX_MESSAGE_CHARS) return "invalid";
  return { shown };
}

/**
 * A streamed Read aloud response (see shared/read-aloud-stream.ts). `produce` sends frames as it
 * goes; a failure it throws becomes an error frame. The browser going away, or cancelling the
 * stream, aborts `signal`, which cancels the OpenAI requests still running.
 */
function streamResponse(
  produce: (send: (frame: ReadAloudStreamFrame) => void, signal: AbortSignal) => Promise<void>,
  requestSignal: AbortSignal,
): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancelled.signal]);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: ReadAloudStreamFrame) => {
        if (!signal.aborted) controller.enqueue(encodeReadAloudFrame(frame));
      };
      try {
        await produce(send, signal);
      } catch (error) {
        send({
          type: "error",
          message: `Read aloud failed. ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      if (!signal.aborted) controller.close();
    },
    cancel() {
      cancelled.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": READ_ALOUD_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store",
      // Proxies must pass each piece on as it comes instead of holding the whole response.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Settings for a replay: the source's, with whatever the request overrides. Returns an error text when invalid. */
function parseReplaySettings(body: Record<string, unknown>, base: ReadAloudSettings): ReadAloudSettings | string {
  const settings = { ...base };
  for (const key of ["rewriteModel", "ttsModel", "voice", "voiceStyle"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > MAX_SETTING_CHARS) return `${key} must be a string`;
    if (key !== "voiceStyle" && !value.trim()) return `${key} must not be empty`;
    settings[key] = value.trim();
  }
  if (body.rewriteSystemPrompt !== undefined) {
    const prompt = body.rewriteSystemPrompt;
    if (prompt !== null && (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_SETTING_CHARS)) {
      return "rewriteSystemPrompt must be a non-empty string, or null to skip the rewrite";
    }
    settings.rewriteSystemPrompt = prompt;
  }
  return settings;
}
