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
import * as questStore from "./quest-store.js";

vi.mock("./settings-manager.js", () => ({ getSettings: vi.fn(), GPT_TRANSCRIBE_STT_MODEL: "gpt-transcribe" }));
vi.mock("./session-names.js", () => ({ getName: vi.fn(), getAllNames: () => ({}) }));
vi.mock("./quest-store.js", () => ({ listQuests: vi.fn() }));
vi.mock("./tree-group-store.js", () => ({ getState: async () => ({ groups: [], assignments: {} }) }));

const now = Date.now();
let app: Hono;
let recordingRoot: string;
let sessions: Record<string, { state: object; messageHistory: object[]; taskHistory: [] }>;

function userMessage(content: string, threadKey = "main") {
  return { type: "user_message", content, timestamp: now - 60_000, threadKey };
}

beforeEach(async () => {
  vi.clearAllMocks();
  recordingRoot = await mkdtemp(join(tmpdir(), "transcription-workspace-recordings-"));
  _setTranscriptionRecordingRootForTest(recordingRoot);
  _resetTranscriptionLogForTest();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Unmocked provider request"))),
  );
  vi.mocked(settingsManager.getSettings).mockReturnValue({
    transcriptionConfig: {
      apiKey: "fixture-key",
      baseUrl: "https://example.test/v1",
      sttModel: "gpt-transcribe",
      enhancementEnabled: false,
      customVocabulary: "Takode, Yes",
    },
    namerConfig: { backend: "claude" },
  } as ReturnType<typeof settingsManager.getSettings>);
  vi.mocked(questStore.listQuests).mockResolvedValue([
    { questId: "q-1", title: "Analyze seeded-QA signals", sessionSpaceSlug: "work", createdAt: now - 3_600_000 },
    { questId: "q-2", title: "Unrelated other-space quest", sessionSpaceSlug: "home", createdAt: now - 3_600_000 },
  ] as Awaited<ReturnType<typeof questStore.listQuests>>);

  // The dictating session and another session in the same (default) space.
  sessions = {
    "session-1": {
      state: {},
      messageHistory: [userMessage("Notes in my own thread about Kestrel and Kestrel again.")],
      taskHistory: [],
    },
    "session-2": {
      state: {},
      messageHistory: [userMessage("Ask Wenxu about the Condor job. Wenxu agreed to check Condor.")],
      taskHistory: [],
    },
  };
  app = new Hono();
  app.route(
    "/api",
    createTranscriptionRoutes({
      launcher: {
        listSessions: () => Object.keys(sessions).map((sessionId) => ({ sessionId })),
        getSession: () => ({ memorySessionSpaceSlug: "work" }),
        getMemorySessionSpaceSlug: () => "work",
        getSessionNum: () => undefined,
      },
      wsBridge: { getSession: (id: string) => sessions[id], broadcastToSession: vi.fn() },
    } as unknown as RouteContext),
  );
});

afterEach(async () => {
  _setTranscriptionRecordingRootForTest(null);
  await rm(recordingRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function transcribe(extra: Record<string, string> = {}) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: "ask when she about the condo job" })));
  const form = new FormData();
  form.append("audio", new Blob(["audio"], { type: "audio/wav" }), "recording.wav");
  form.append("backend", "openai");
  form.append("sessionId", "session-1");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await app.request("/api/transcribe", { method: "POST", body: form });
  await res.text();
  return vi.mocked(fetch).mock.calls.at(-1)![1]!.body as FormData;
}

describe("transcription workspace context", () => {
  it("sends terms and activity from other sessions in the space, and the space's quests", async () => {
    // Real route and prompt construction with mocked fetch: no provider calls.
    const sent = await transcribe();
    // The user's own vocabulary is never filtered, even an everyday word the picker would drop.
    expect(sent.getAll("keywords[]")).toEqual(expect.arrayContaining(["Takode", "Yes", "Wenxu", "Condor", "Kestrel"]));
    const prompt = String(sent.get("prompt"));
    expect(prompt).toContain("Recent quests: Analyze seeded-QA signals");
    expect(prompt).not.toContain("Unrelated other-space quest");
    expect(prompt).toContain("[user] Ask Wenxu about the Condor job.");
    // The dictated thread's own messages reach the prompt as conversation, not as workspace activity.
    const activity = prompt.slice(prompt.indexOf("<RECENT_ACTIVITY>"), prompt.indexOf("</RECENT_ACTIVITY>"));
    expect(activity).not.toContain("Kestrel");
  });

  it("gives comment voice input the same workspace terms", async () => {
    const context = { activeId: "active", selectedText: "the job", mainComposerText: "", otherAnnotations: [] };
    const sent = await transcribe({ annotationContext: JSON.stringify(context), composerText: "" });
    expect(sent.getAll("keywords[]")).toEqual(expect.arrayContaining(["Wenxu", "Condor"]));
    expect(String(sent.get("prompt"))).toContain('"recent_quests": "Recent quests: Analyze seeded-QA signals"');
  });

  it("reuses the quest titles and terms between dictations but reads recent activity fresh", async () => {
    await transcribe();
    sessions["session-2"]!.messageHistory.push(userMessage("Ping Lianghong about the eval."));
    const sent = await transcribe();
    expect(questStore.listQuests).toHaveBeenCalledTimes(1);
    expect(String(sent.get("prompt"))).toContain("[user] Ping Lianghong about the eval.");
  });
});
