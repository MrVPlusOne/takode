import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { ReadAloudRun, ReadAloudSettings } from "../read-aloud.js";

const mocks = vi.hoisted(() => ({ apiKey: "sk-test" as string | null }));
vi.mock("../transcription.js", () => ({ resolveOpenAIKey: () => mocks.apiKey }));
vi.mock("../settings-manager.js", () => ({
  getSettings: () => ({ transcriptionConfig: { baseUrl: "https://openai.example.test/v1" } }),
}));

import { DEFAULT_READ_ALOUD_SETTINGS } from "../read-aloud.js";
import { ReadAloudRecordStore } from "../read-aloud-records.js";
import { registerSessionReadAloudRoute } from "./session-read-aloud-route.js";

const history: BrowserIncomingMessage[] = [
  { type: "user_message", id: "u1", content: "Please fix the timer", timestamp: 1 } as BrowserIncomingMessage,
];

/** A fake pipeline: "audio" is the voice name, so tests can tell reads apart. */
function fakeRun(fail = false) {
  return vi.fn(
    async (
      input: { messageText: string },
      _config: unknown,
      settings: ReadAloudSettings = DEFAULT_READ_ALOUD_SETTINGS,
    ): Promise<ReadAloudRun> => ({
      trace: {
        settings,
        rewriteUserPrompt: settings.rewriteSystemPrompt === null ? null : `<MESSAGE>\n${input.messageText}\n</MESSAGE>`,
        rewriteOutput: settings.rewriteSystemPrompt === null ? null : "Spoken version.",
        rewriteCached: false,
        spokenText: "Spoken version.",
        speechParts: 1,
        rewriteMs: 5,
        speechMs: 7,
      },
      audio: fail ? null : new TextEncoder().encode(settings.voice),
      error: fail ? "OpenAI /audio/speech failed with 500: boom" : null,
    }),
  );
}

let root: string;

beforeEach(async () => {
  mocks.apiKey = "sk-test";
  root = await mkdtemp(join(tmpdir(), "read-aloud-route-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeApp(run = fakeRun()) {
  const records = new ReadAloudRecordStore(root);
  const api = new Hono();
  registerSessionReadAloudRoute(api, {
    wsBridge: { getSession: (id: string) => (id === "s1" ? { messageHistory: history } : null) } as any,
    resolveId: (raw) => (raw === "s1" || raw === "12" ? "s1" : null),
    run,
    records,
  });
  const post = (path: string, body: unknown) =>
    api.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { api, post, run, records };
}

/** The main route saves its debug record without waiting; wait until it is on disk. */
async function waitForRecords(records: ReadAloudRecordStore, count: number) {
  await vi.waitFor(async () => expect(await records.listRecent()).toHaveLength(count));
  return records.listRecent();
}

describe("POST /sessions/:id/read-aloud", () => {
  it("returns MP3 audio of the message with the conversation as context, and records it", async () => {
    const { post, run, records } = makeApp();
    const res = await post("/sessions/12/read-aloud", { messageId: "a1", text: " Fixed it. ", historyIndex: 1 });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("marin");
    const [input, config] = run.mock.calls[0] as unknown as [
      { messageText: string; conversationContext: string },
      { apiKey: string; baseUrl: string },
    ];
    expect(input.messageText).toBe("Fixed it.");
    expect(input.conversationContext).toContain("Please fix the timer");
    expect(config).toMatchObject({ apiKey: "sk-test", baseUrl: "https://openai.example.test/v1" });

    const [summary] = await waitForRecords(records, 1);
    expect(summary).toMatchObject({ sessionId: "s1", previewText: "Fixed it.", voice: "marin", error: null });
  });

  it("explains where to add a key when none is set", async () => {
    mocks.apiKey = null;
    const { post, run } = makeApp();
    const res = await post("/sessions/s1/read-aloud", { messageId: "a1", text: "Hi" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Settings > Voice Input");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects unknown sessions and missing text", async () => {
    const { post } = makeApp();
    expect((await post("/sessions/nope/read-aloud", { messageId: "a1", text: "Hi" })).status).toBe(404);
    expect((await post("/sessions/s1/read-aloud", { messageId: "a1", text: "   " })).status).toBe(400);
  });

  it("reports provider failures as a readable error and records them", async () => {
    const { post, records } = makeApp(fakeRun(true));
    const res = await post("/sessions/s1/read-aloud", { messageId: "a1", text: "Hi" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Read aloud failed. OpenAI /audio/speech failed with 500: boom");
    const [summary] = await waitForRecords(records, 1);
    expect(summary.error).toContain("boom");
  });
});

describe("read-aloud debug records", () => {
  it("shows a record's prompts, replays it with other settings and serves both audios", async () => {
    const { api, post, run, records } = makeApp();
    await post("/sessions/s1/read-aloud", { messageId: "a1", text: "Fixed it." });
    const [summary] = await waitForRecords(records, 1);

    const replayRes = await post(`/read-aloud/records/${summary.id}/replay`, {
      voice: "cedar",
      voiceStyle: "Speak quickly.",
      rewriteSystemPrompt: null,
    });
    expect(replayRes.status).toBe(200);
    const { record: replay } = await replayRes.json();
    // The replay reuses the recorded message and context, with the new settings.
    expect(run.mock.calls[1][0]).toEqual({
      messageText: "Fixed it.",
      conversationContext: expect.stringContaining("Please fix"),
    });
    expect(replay.trace.settings).toMatchObject({
      voice: "cedar",
      voiceStyle: "Speak quickly.",
      rewriteSystemPrompt: null,
    });

    const detail = await (await api.request(`/read-aloud/records/${summary.id}`)).json();
    expect(detail.record.trace.rewriteUserPrompt).toBe("<MESSAGE>\nFixed it.\n</MESSAGE>");
    expect(detail.replays.map((r: { id: string }) => r.id)).toEqual([replay.id]);
    expect(detail.voices).toContain("cedar");
    expect(detail.defaults.voice).toBe("marin");

    const audio = await api.request(`/read-aloud/records/${replay.id}/audio`);
    expect(new TextDecoder().decode(await audio.arrayBuffer())).toBe("cedar");
    // Replays stay inside their source in the list.
    expect(await records.listRecent()).toHaveLength(1);
  });

  it("rejects invalid replay settings and unknown or unsafe record ids", async () => {
    const { api, post, records } = makeApp();
    await post("/sessions/s1/read-aloud", { messageId: "a1", text: "Fixed it." });
    const [summary] = await waitForRecords(records, 1);
    expect((await post(`/read-aloud/records/${summary.id}/replay`, { voice: "  " })).status).toBe(400);
    expect((await post(`/read-aloud/records/${summary.id}/replay`, { rewriteSystemPrompt: "" })).status).toBe(400);
    expect((await api.request("/read-aloud/records/missing")).status).toBe(404);
    expect((await api.request("/read-aloud/records/..%2F..%2Fetc/audio")).status).toBe(404);
  });
});
