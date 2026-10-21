import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTranscriptionRoutes } from "./routes/transcription.js";
import type { RouteContext } from "./routes/context.js";
import type { SessionDraftsState } from "../shared/session-drafts.js";
import { _setTranscriptionRecordingRootForTest } from "./transcription-recordings.js";
import { _resetTranscriptionLogForTest } from "./transcription-enhancer.js";
import * as settingsManager from "./settings-manager.js";

vi.mock("./settings-manager.js", () => ({ getSettings: vi.fn(), GPT_TRANSCRIBE_STT_MODEL: "gpt-transcribe" }));
vi.mock("./session-names.js", () => ({ getName: vi.fn(), getAllNames: () => ({}) }));
vi.mock("./quest-store.js", () => ({ listQuests: vi.fn(async () => []) }));
vi.mock("./tree-group-store.js", () => ({ getState: async () => ({ groups: [], assignments: {} }) }));

// A finished transcription that names its target draft is kept on the server until a browser
// claims it, so it is not lost when the recording browser moved on or reloaded. Real route,
// mocked provider fetch: no provider calls.

let app: Hono;
let recordingRoot: string;
let session: { id: string; state: object; messageHistory: object[]; taskHistory: []; drafts?: SessionDraftsState };
const broadcastToSession = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  recordingRoot = await mkdtemp(join(tmpdir(), "transcription-voice-results-"));
  _setTranscriptionRecordingRootForTest(recordingRoot);
  _resetTranscriptionLogForTest();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ text: "Ship it" }))),
  );
  vi.mocked(settingsManager.getSettings).mockReturnValue({
    transcriptionConfig: { apiKey: "fixture-key", sttModel: "gpt-transcribe", enhancementEnabled: false },
    namerConfig: { backend: "claude" },
  } as ReturnType<typeof settingsManager.getSettings>);
  session = { id: "s1", state: {}, messageHistory: [], taskHistory: [] };
  app = new Hono();
  app.route(
    "/api",
    createTranscriptionRoutes({
      launcher: {
        listSessions: () => [{ sessionId: "s1" }],
        getSession: () => ({}),
        getMemorySessionSpaceSlug: () => "work",
        getSessionNum: () => undefined,
      },
      wsBridge: {
        getSession: (id: string) => (id === "s1" ? session : undefined),
        broadcastToSession,
        persistSessionById: vi.fn(),
      },
    } as unknown as RouteContext),
  );
});

afterEach(async () => {
  _setTranscriptionRecordingRootForTest(null);
  await rm(recordingRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function transcribe(fields: Record<string, string>) {
  const form = new FormData();
  form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
  form.append("backend", "openai");
  form.append("sessionId", "s1");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return app.request("/api/transcribe", { method: "POST", body: form });
}

const target = { kind: "composer", baseText: "", selectionStart: 0, selectionEnd: 0 };

describe("kept voice transcription results", () => {
  it("keeps a result that names its draft, marks it recoverable and announces it", async () => {
    const res = await transcribe({ requestId: "voice-1", draftTarget: JSON.stringify(target) });
    expect(await res.text()).toContain('"recoverable":true');
    expect(session.drafts?.voiceResults?.["voice-1"]).toMatchObject({ target, mode: "dictation", text: "Ship it" });
    expect(broadcastToSession).toHaveBeenCalledWith("s1", {
      type: "voice_result_pending",
      result: expect.objectContaining({ requestId: "voice-1" }),
    });
  });

  it("keeps nothing for a request that names no draft, such as a comment", async () => {
    const res = await transcribe({ requestId: "voice-2" });
    expect(await res.text()).not.toContain("recoverable");
    expect(session.drafts?.voiceResults).toBeUndefined();
  });

  it("rejects a malformed target", async () => {
    const res = await transcribe({ requestId: "voice-3", draftTarget: JSON.stringify({ ...target, selectionEnd: 5 }) });
    expect(res.status).toBe(400);
  });
});
