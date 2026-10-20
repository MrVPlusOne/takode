import type { Hono } from "hono";
import type { WsBridge } from "../ws-bridge.js";
import { getSettings } from "../settings-manager.js";
import { resolveOpenAIKey } from "../transcription.js";
import {
  DEFAULT_READ_ALOUD_SETTINGS,
  READ_ALOUD_VOICES,
  buildReadAloudContext,
  runReadAloud,
  type ReadAloudOpenAIConfig,
  type ReadAloudSettings,
} from "../read-aloud.js";
import { ReadAloudRecordStore } from "../read-aloud-records.js";

const MAX_MESSAGE_CHARS = 60_000;
const MAX_SETTING_CHARS = 20_000;
const MISSING_KEY_ERROR = "Add an OpenAI API key in Settings > Voice Input to use Read aloud";

export interface SessionReadAloudRouteDeps {
  wsBridge: WsBridge;
  resolveId: (idOrNum: string) => string | null;
  /** Replaceable in tests; default to the real OpenAI pipeline and record folder. */
  run?: typeof runReadAloud;
  records?: ReadAloudRecordStore;
}

/**
 * Read aloud: POST /sessions/:id/read-aloud returns MP3 audio of one assistant message.
 * The browser sends the text it shows (so merged or thread-prefixed messages read as
 * displayed); the server adds the conversation context and calls OpenAI with the
 * Voice Input key. Every read is recorded for the Read Aloud debug panel, whose
 * /read-aloud/records routes list, show and replay records with other settings.
 */
export function registerSessionReadAloudRoute(api: Hono, deps: SessionReadAloudRouteDeps): void {
  const { wsBridge, resolveId, run = runReadAloud } = deps;
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
    if (text.length > MAX_MESSAGE_CHARS) return c.json({ error: "This message is too long to read aloud" }, 413);
    const voice = body.voice ?? DEFAULT_READ_ALOUD_SETTINGS.voice;
    if (!READ_ALOUD_VOICES.includes(voice)) return c.json({ error: `Unknown voice: ${String(voice)}` }, 400);
    const config = openAIConfig(c.req.raw.signal);
    if (!config) return c.json({ error: MISSING_KEY_ERROR }, 400);

    const conversationContext = buildReadAloudContext(session.messageHistory, messageId, historyIndex);
    const result = await run({ messageText: text, conversationContext }, config, {
      ...DEFAULT_READ_ALOUD_SETTINGS,
      voice,
    });
    void records
      .create(
        { sessionId, messageId, messageText: text, conversationContext, trace: result.trace, error: result.error },
        result.audio,
      )
      .catch((error) => console.warn(`[read-aloud] Could not save the debug record: ${error}`));
    if (!result.audio) {
      console.warn(`[read-aloud] Session ${sessionId.slice(0, 8)} failed: ${result.error}`);
      return c.json({ error: `Read aloud failed. ${result.error}` }, 502);
    }
    return new Response(result.audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  });

  api.get("/read-aloud/records", async (c) => {
    return c.json({ records: await records.listRecent() });
  });

  api.get("/read-aloud/records/:recordId", async (c) => {
    const record = await records.get(c.req.param("recordId"));
    if (!record) return c.json({ error: "Record not found" }, 404);
    const replays = (await Promise.all(record.replayIds.map((id) => records.get(id)))).filter((r) => r !== null);
    return c.json({ record, replays, defaults: DEFAULT_READ_ALOUD_SETTINGS, voices: READ_ALOUD_VOICES });
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

    const input = { messageText: source.messageText, conversationContext: source.conversationContext };
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
