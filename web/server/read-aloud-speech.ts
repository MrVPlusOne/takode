import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Some speech requests stream slower than real time (30-40 s for a piece that normally
 * takes 3-4 s) while their headers arrive as fast as any other. In October 2026 this hit
 * random requests, up to a quarter of them in bad minutes, not particular texts. Every
 * piece is therefore requested twice from the start (once for models that rarely do
 * this) and once more every SPEECH_HEDGE_EVERY_MS (longer for long pieces) while none
 * has finished; the first complete answer wins and the rest are cancelled.
 */
const SPEECH_HEDGE_EVERY_MS = 5_000;
/** Long pieces take longer to speak, so their next request waits longer: about 12 ms per character. */
const SPEECH_HEDGE_MS_PER_CHAR = 12;
const SPEECH_MAX_REQUESTS = 4;
/**
 * OpenAI's own MP3 is 128 kbps, about 1 MB a minute. Speech is fetched as raw PCM and
 * encoded here at 48 kbps (about 0.36 MB a minute) for slow phone connections; at
 * 32 kbps this encoder produced unusable audio.
 */
const SPEECH_SAMPLE_RATE = 24_000;
const MP3_KBPS = 48;
/** Samples encoded between event-loop yields (about 2.4 s of audio, a few ms of CPU). */
const MP3_ENCODE_BLOCK_SAMPLES = 1152 * 50;

export type FetchSpeechPcm = (text: string, signal: AbortSignal) => Promise<Uint8Array>;

/**
 * Speech for one message, built piece by piece: each piece is requested as soon as it
 * is added (with hedged duplicates) and encoded into one MP3 in text order as soon as
 * it and every earlier piece have arrived.
 */
export class SpeechJob {
  /** Speech requests sent, including duplicates. */
  requests = 0;
  /** CPU time spent encoding MP3. */
  encodeMs = 0;
  pieces = 0;
  private readonly controller = new AbortController();
  private readonly encoder = new Mp3Encoder(1, SPEECH_SAMPLE_RATE, MP3_KBPS);
  private readonly frames: Uint8Array[] = [];
  private encoded: Promise<void> = Promise.resolve();

  private readonly initialRequests: number;

  constructor(
    private readonly fetchPcm: FetchSpeechPcm,
    options: { signal?: AbortSignal; initialRequests?: number } = {},
  ) {
    this.initialRequests = options.initialRequests ?? 2;
    options.signal?.addEventListener("abort", () => this.controller.abort(options.signal?.reason), { once: true });
  }

  /** Start speaking one more piece of text, after the pieces added before it. */
  add(text: string): void {
    this.pieces++;
    const pcm = this.hedgedSpeech(text);
    // The encode chain reports a failure; this only keeps a later piece's failure from going unhandled.
    pcm.catch(() => {});
    this.encoded = this.encoded.then(async () => this.encode(await pcm));
  }

  /** The finished MP3, once every piece has arrived and been encoded. */
  async finish(): Promise<Uint8Array<ArrayBuffer>> {
    try {
      await this.encoded;
    } catch (error) {
      this.cancel();
      throw error;
    }
    this.frames.push(this.encoder.flush());
    return concatBytes(this.frames);
  }

  /** Stop every request still running, for example when the rewrite failed. */
  cancel(): void {
    this.controller.abort();
  }

  private hedgedSpeech(text: string): Promise<Uint8Array> {
    const attempts: AbortController[] = [];
    let running = 0;
    let settled = false;
    let lastError: unknown = null;
    return new Promise<Uint8Array>((resolve, reject) => {
      const finish = (outcome: () => void) => {
        settled = true;
        clearInterval(hedgeTimer);
        for (const attempt of attempts) attempt.abort();
        outcome();
      };
      const start = () => {
        if (settled || attempts.length >= SPEECH_MAX_REQUESTS) return;
        const attempt = new AbortController();
        attempts.push(attempt);
        running++;
        this.requests++;
        this.fetchPcm(text, AbortSignal.any([this.controller.signal, attempt.signal])).then(
          (pcm) => {
            if (!settled) finish(() => resolve(pcm));
          },
          (error: unknown) => {
            running--;
            if (settled) return;
            lastError = error;
            if (this.controller.signal.aborted) return finish(() => reject(error));
            // An error answer gets one more try unless another request is still running.
            if (running === 0 && attempts.length < SPEECH_MAX_REQUESTS) return start();
            if (running === 0) finish(() => reject(lastError));
          },
        );
      };
      const hedgeTimer = setInterval(start, Math.max(SPEECH_HEDGE_EVERY_MS, text.length * SPEECH_HEDGE_MS_PER_CHAR));
      for (let i = 0; i < this.initialRequests; i++) start();
    });
  }

  /** Encode 24 kHz 16-bit mono PCM, yielding between blocks so other requests keep flowing. */
  private async encode(pcm: Uint8Array): Promise<void> {
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    for (let start = 0; start < samples.length; start += MP3_ENCODE_BLOCK_SAMPLES) {
      const startedAt = performance.now();
      this.frames.push(this.encoder.encodeBuffer(samples.subarray(start, start + MP3_ENCODE_BLOCK_SAMPLES)));
      this.encodeMs += performance.now() - startedAt;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
