import type { BrowserIncomingMessage } from "./session-types.js";
import { buildTranscriptionContext } from "./transcription-enhancer.js";
import { findStableStarTarget } from "./starred-messages.js";
import { buildProjectedThreadEntries } from "../shared/thread-window.js";
import { Mp3Encoder } from "@breezystack/lamejs";

/** The voices OpenAI's speech endpoint offers. */
export const READ_ALOUD_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;
/** The model's whole answer when the message already reads well aloud. */
const UNCHANGED_MARKER = "UNCHANGED";
/**
 * Speech requests take at most 4,096 characters. Smaller pieces are synthesized in
 * parallel so a long message is ready about as fast as a short one.
 */
const TTS_CHUNK_TARGET_CHARS = 350;
const TTS_CHUNK_MAX_CHARS = 4096;
const OPENAI_TIMEOUT_MS = 60_000;
/**
 * OpenAI's own MP3 is 128 kbps, about 1 MB a minute. Speech is fetched as raw PCM and
 * encoded here at 48 kbps (about 0.36 MB a minute) for slow phone connections; at
 * 32 kbps this encoder produced unusable audio.
 */
const SPEECH_SAMPLE_RATE = 24_000;
const MP3_KBPS = 48;
/** Samples encoded between event-loop yields (about 2.4 s of audio, a few ms of CPU). */
const MP3_ENCODE_BLOCK_SAMPLES = 1152 * 50;
/** Rewrites kept so reading a message again, such as in another voice, skips the rewrite. */
const REWRITE_CACHE_LIMIT = 50;
const rewriteCache = new Map<string, string>();

const REWRITE_SYSTEM_PROMPT = `You prepare an AI assistant's chat message to be read aloud by a text-to-speech voice to a listener who cannot see the screen, for example while driving.

First decide whether the message needs rewriting to be easy to follow when heard.
- If it already reads naturally aloud (plain conversational prose with no Markdown, code, links, tables, file paths, IDs or symbols that sound wrong when spoken), output exactly ${UNCHANGED_MARKER} and nothing else.
- Otherwise rewrite it:
  - Keep every key point, decision, question and caveat, with the original meaning and tone. Stay close to the original wording. Do not summarize content away, add information, or answer questions the message asks.
  - Keep the assistant's voice: first person, speaking to the listener as "you".
  - Remove Markdown and symbols. Turn lists and tables into short spoken sentences.
  - Leave out code, commands, URLs, link targets, commit hashes, file paths, line numbers and internal IDs such as quest, session or message numbers. When one matters, describe it briefly in words instead, such as "the settings file" or "that quest".
  - Write abbreviations, units and symbols the way a person would say them.
  - Prefer short sentences, with a blank line between topics.
- Write in the language of the message.

<CONVERSATION_CONTEXT> holds earlier messages only to help you understand what the message refers to. Never read it aloud, quote it, or reply to it.

Output only the text to speak, or ${UNCHANGED_MARKER}.`;

export interface ReadAloudSettings {
  /** Text model that decides whether the message needs rewriting for listening, and rewrites it. */
  rewriteModel: string;
  /** System prompt of the rewrite; null skips the rewrite and reads the message as written. */
  rewriteSystemPrompt: string | null;
  /** Non-realtime OpenAI text-to-speech model. OpenAI plans to retire gpt-4o-mini-tts on January 6, 2027. */
  ttsModel: string;
  voice: string;
  /** Speaking instructions sent with every speech request. */
  voiceStyle: string;
}

/** What Message options > Read aloud uses. */
export const DEFAULT_READ_ALOUD_SETTINGS: ReadAloudSettings = {
  rewriteModel: "gpt-5.5",
  rewriteSystemPrompt: REWRITE_SYSTEM_PROMPT,
  ttsModel: "gpt-4o-mini-tts",
  voice: "marin",
  voiceStyle: "Speak in a natural, warm, conversational tone at a comfortable, unhurried pace.",
};

export interface ReadAloudOpenAIConfig {
  apiKey: string;
  /** OpenAI-compatible API base, such as https://api.openai.com/v1. */
  baseUrl: string;
  /** Lets the caller cancel the upstream calls, for example when the browser gives up. */
  signal?: AbortSignal;
}

/** Everything one read sent and got back, kept for the Read Aloud debug panel. */
export interface ReadAloudTrace {
  settings: ReadAloudSettings;
  /** The exact user message of the rewrite request; null when the rewrite was skipped. */
  rewriteUserPrompt: string | null;
  /** The rewrite model's answer as returned, including the UNCHANGED marker. */
  rewriteOutput: string | null;
  /** True when an identical earlier rewrite was reused instead of asking the model again. */
  rewriteCached: boolean;
  /** The text the voice read. Empty when the read failed before speech. */
  spokenText: string;
  speechParts: number;
  rewriteMs: number;
  speechMs: number;
}

export interface ReadAloudRun {
  trace: ReadAloudTrace;
  /** MP3 audio of the whole message (48 kbps mono), or null when the read failed. */
  audio: Uint8Array<ArrayBuffer> | null;
  error: string | null;
}

/**
 * Turn an assistant message into speech: an optional rewrite for listening, using
 * earlier conversation as context, then text-to-speech that reads the result word
 * for word. Provider failures come back as `error` with the trace so far.
 */
export async function runReadAloud(
  input: { messageText: string; conversationContext: string },
  config: ReadAloudOpenAIConfig,
  settings: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS,
): Promise<ReadAloudRun> {
  const trace: ReadAloudTrace = {
    settings,
    rewriteUserPrompt: null,
    rewriteOutput: null,
    rewriteCached: false,
    spokenText: "",
    speechParts: 0,
    rewriteMs: 0,
    speechMs: 0,
  };
  try {
    const startedAt = Date.now();
    if (settings.rewriteSystemPrompt !== null) {
      trace.rewriteUserPrompt = buildRewriteUserPrompt(input);
      const cacheKey = JSON.stringify([settings.rewriteModel, settings.rewriteSystemPrompt, trace.rewriteUserPrompt]);
      const cached = rewriteCache.get(cacheKey);
      trace.rewriteCached = cached !== undefined;
      trace.rewriteOutput = cached ?? (await rewriteForListening(trace.rewriteUserPrompt, settings, config));
      rememberRewrite(cacheKey, trace.rewriteOutput);
      trace.rewriteMs = Date.now() - startedAt;
    }
    const output = trace.rewriteOutput;
    trace.spokenText = output === null || output === UNCHANGED_MARKER ? input.messageText : output;
    const chunks = splitTextForSpeech(trace.spokenText);
    trace.speechParts = chunks.length;
    const speechStartedAt = Date.now();
    const parts = await Promise.all(chunks.map((chunk) => synthesizeSpeech(chunk, settings, config)));
    const audio = await encodeMp3(concatBytes(parts));
    trace.speechMs = Date.now() - speechStartedAt;
    console.log(
      `[read-aloud] ${input.messageText.length} chars -> ${trace.spokenText.length} spoken, rewrite ${trace.rewriteMs}ms, speech ${trace.speechMs}ms in ${chunks.length} part(s)`,
    );
    return { trace, audio, error: null };
  } catch (error) {
    return { trace, audio: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** True when the rewrite model judged the message fine to read as written. */
export function readAloudKeptOriginal(trace: ReadAloudTrace): boolean {
  return trace.rewriteOutput === null || trace.rewriteOutput === UNCHANGED_MARKER;
}

/**
 * The conversation leading up to a message, as context for its rewrite. For leader
 * thread messages only that thread counts. Falls back to the latest conversation
 * when the message is not in the history.
 */
export function buildReadAloudContext(
  history: ReadonlyArray<BrowserIncomingMessage>,
  messageId: string,
  historyIndex?: number,
): string {
  const target = findStableStarTarget(history, messageId, historyIndex);
  if (!target) return buildTranscriptionContext([...history]);
  const earlier = history.slice(0, target.historyIndex);
  const threadHistory = buildProjectedThreadEntries(earlier, target.sourceThreadKey).map((entry) => entry.message);
  return buildTranscriptionContext(threadHistory);
}

/**
 * Split text into pieces of at most TTS_CHUNK_MAX_CHARS, packing whole sentences up to
 * about TTS_CHUNK_TARGET_CHARS so every piece ends at a natural pause and long
 * messages turn into many small requests that run in parallel.
 */
export function splitTextForSpeech(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+|(?<=[。！？])/)
        .flatMap((sentence) => splitLongUnit(sentence, /\s+/))
        .filter(Boolean),
    );

  const chunks: string[] = [];
  let current = "";
  for (const sentences of paragraphs) {
    sentences.forEach((sentence, index) => {
      const separator = index === 0 ? "\n\n" : " ";
      const joined = current ? `${current}${separator}${sentence}` : sentence;
      if (current && joined.length > TTS_CHUNK_TARGET_CHARS) {
        chunks.push(current);
        current = sentence;
      } else {
        current = joined;
      }
    });
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Break a unit longer than the hard limit at the given separator, falling back to a hard cut. */
function splitLongUnit(unit: string, separator: RegExp): string[] {
  if (unit.length <= TTS_CHUNK_MAX_CHARS) return [unit];
  const pieces: string[] = [];
  let current = "";
  for (const part of unit.split(separator)) {
    const joined = current ? `${current} ${part}` : part;
    if (joined.length <= TTS_CHUNK_MAX_CHARS) {
      current = joined;
      continue;
    }
    if (current) pieces.push(current);
    current = part;
    while (current.length > TTS_CHUNK_MAX_CHARS) {
      pieces.push(current.slice(0, TTS_CHUNK_MAX_CHARS));
      current = current.slice(TTS_CHUNK_MAX_CHARS);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function rememberRewrite(key: string, output: string): void {
  rewriteCache.delete(key);
  rewriteCache.set(key, output);
  if (rewriteCache.size > REWRITE_CACHE_LIMIT) rewriteCache.delete(rewriteCache.keys().next().value!);
}

function buildRewriteUserPrompt(input: { messageText: string; conversationContext: string }): string {
  return [
    input.conversationContext ? `<CONVERSATION_CONTEXT>\n${input.conversationContext}\n</CONVERSATION_CONTEXT>` : "",
    `<MESSAGE>\n${input.messageText}\n</MESSAGE>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Returns the rewrite model's answer: the text to speak, or the UNCHANGED marker. */
async function rewriteForListening(
  userPrompt: string,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
): Promise<string> {
  const res = await openAIRequest("/chat/completions", config, {
    model: settings.rewriteModel,
    messages: [
      { role: "system", content: settings.rewriteSystemPrompt },
      { role: "user", content: userPrompt },
    ],
    reasoning_effort: "none",
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error("The rewrite model returned no text");
  if (choice?.finish_reason !== "stop") throw new Error("The rewrite model stopped before finishing");
  return text;
}

async function synthesizeSpeech(
  text: string,
  settings: ReadAloudSettings,
  config: ReadAloudOpenAIConfig,
): Promise<Uint8Array> {
  const res = await openAIRequest("/audio/speech", config, {
    model: settings.ttsModel,
    voice: settings.voice,
    input: text,
    ...(settings.voiceStyle.trim() ? { instructions: settings.voiceStyle } : {}),
    response_format: "pcm",
  });
  return new Uint8Array(await res.arrayBuffer());
}

async function openAIRequest(path: string, config: ReadAloudOpenAIConfig, body: object): Promise<Response> {
  const timeout = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal: config.signal ? AbortSignal.any([config.signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${path} failed with ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  return res;
}

function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode 24 kHz 16-bit mono PCM as MP3, yielding between blocks so other requests keep flowing. */
async function encodeMp3(pcm: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const encoder = new Mp3Encoder(1, SPEECH_SAMPLE_RATE, MP3_KBPS);
  const frames: Uint8Array[] = [];
  for (let start = 0; start < samples.length; start += MP3_ENCODE_BLOCK_SAMPLES) {
    frames.push(encoder.encodeBuffer(samples.subarray(start, start + MP3_ENCODE_BLOCK_SAMPLES)));
    await new Promise((resolve) => setImmediate(resolve));
  }
  frames.push(encoder.flush());
  return concatBytes(frames);
}
