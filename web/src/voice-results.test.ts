// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDraftsState } from "../shared/session-drafts.js";
import type { PendingVoiceResult, VoiceResultTarget } from "../shared/voice-results.js";
import { addPendingVoiceResult, claimPendingVoiceResult } from "../server/bridge/session-drafts-controller.js";
import type { SessionNotification } from "../server/session-types.js";

// Finished voice transcriptions reaching their draft exactly once. "This tab" is the real store and
// delivery module; the server is the real draft controller behind a mocked API.

const server = vi.hoisted(() => ({
  session: {
    id: "s1",
    notifications: [] as SessionNotification[],
    drafts: undefined as SessionDraftsState | undefined,
  },
}));

vi.mock("./api/session-drafts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/session-drafts.js")>();
  return {
    ...actual,
    writeSessionDraft: vi.fn(async () => ({ kind: "composer", draft: null, revision: 1, clientId: "x", updatedAt: 1 })),
    claimVoiceResult: vi.fn(
      async (_sessionId: string, requestId: string) =>
        claimPendingVoiceResult(server.session, requestId, { persistSession: () => {} }) ?? null,
    ),
  };
});

import { useStore } from "./store.js";
import { useGuidedReviewState } from "./guided-review-state.js";
import { resetDraftSyncForTests } from "./draft-sync.js";
import { claimOwnVoiceResult, receivePendingVoiceResult, trackOwnVoiceRequest } from "./voice-results.js";

const composerTarget = (baseText = ""): VoiceResultTarget => ({
  kind: "composer",
  baseText,
  selectionStart: 0,
  selectionEnd: baseText.length,
});

/** The server finishes a transcription for this session and keeps it. */
function keep(result: Partial<PendingVoiceResult> & { requestId: string }): PendingVoiceResult {
  const pending: PendingVoiceResult = {
    target: composerTarget(),
    mode: "dictation",
    text: "Ship it",
    createdAt: Date.now(),
    ...result,
  };
  addPendingVoiceResult(server.session, pending, { broadcastToBrowsers: () => {}, persistSession: () => {} });
  return pending;
}

const composerText = () => useStore.getState().composerDrafts.get("s1")?.text;

beforeEach(() => {
  vi.useFakeTimers();
  server.session = { id: "s1", notifications: [], drafts: undefined };
  resetDraftSyncForTests();
  useStore.getState().reset();
});

afterEach(() => {
  resetDraftSyncForTests();
  vi.useRealTimers();
});

describe("voice result delivery", () => {
  it("puts a result the recording tab never applied into the composer when the session is shown again", async () => {
    // The tab was reloaded while transcribing; the next snapshot carries the kept result.
    const pending = keep({ requestId: "voice-1" });
    receivePendingVoiceResult("s1", pending, 0);
    await vi.runAllTimersAsync();
    expect(composerText()).toBe("Ship it\n[transcribed]");
    expect(server.session.drafts?.voiceResults).toBeUndefined();
  });

  it("keeps text typed meanwhile and adds the transcript after it", async () => {
    useStore.getState().setComposerDraft("s1", { text: "Typed while waiting", images: [] });
    receivePendingVoiceResult("s1", keep({ requestId: "voice-1" }), 0);
    await vi.runAllTimersAsync();
    expect(composerText()).toBe("Typed while waiting Ship it\n[transcribed]");
  });

  it("applies a result once, however many browsers or messages offer it", async () => {
    const pending = keep({ requestId: "voice-1" });
    receivePendingVoiceResult("s1", pending, 0);
    receivePendingVoiceResult("s1", pending, 0);
    await vi.runAllTimersAsync();
    expect(composerText()).toBe("Ship it\n[transcribed]");

    // Another browser claimed this one first: nothing is applied here.
    const taken = keep({ requestId: "voice-2", text: "Elsewhere" });
    claimPendingVoiceResult(server.session, "voice-2", { persistSession: () => {} });
    receivePendingVoiceResult("s1", taken, 0);
    await vi.runAllTimersAsync();
    expect(composerText()).toBe("Ship it\n[transcribed]");
  });

  it("leaves a tab's own running request to that request, which claims it when it returns", async () => {
    const release = trackOwnVoiceRequest("voice-1");
    const pending = keep({ requestId: "voice-1" });
    receivePendingVoiceResult("s1", pending, 0);
    await vi.runAllTimersAsync();
    expect(composerText()).toBeUndefined();
    expect(await claimOwnVoiceResult("s1", "voice-1", { recoverable: true })).toBe(true);
    expect(await claimOwnVoiceResult("s1", "voice-1", { recoverable: true })).toBe(false);
    release();
  });

  it("puts an answer's result into that question's draft", async () => {
    receivePendingVoiceResult(
      "s1",
      keep({
        requestId: "voice-1",
        target: {
          kind: "needs-input",
          notificationId: "n-1",
          questionKey: "q1",
          baseText: "",
          selectionStart: 0,
          selectionEnd: 0,
        },
      }),
      0,
    );
    await vi.runAllTimersAsync();
    expect(useStore.getState().needsInputDrafts.get("s1")?.get("n-1")?.q1).toBe("Ship it\n[transcribed]");
  });

  it("puts a guided review result into that stop's answer or into the review's message", async () => {
    const reviewTarget = (stopKey: string): VoiceResultTarget => ({
      kind: "guided-review",
      reviewId: "r-1",
      stopKey,
      baseText: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    receivePendingVoiceResult("s1", keep({ requestId: "voice-1", target: reviewTarget("2") }), 0);
    receivePendingVoiceResult(
      "s1",
      keep({ requestId: "voice-2", target: reviewTarget("message"), text: "Draft comments" }),
      0,
    );
    await vi.runAllTimersAsync();
    expect(useGuidedReviewState.getState().drafts["r-1"]).toEqual({
      answers: { "2": "Ship it\n[transcribed]" },
      message: "Draft comments\n[transcribed]",
    });
  });

  it("offers a voice edit as a proposal only while the composer still holds the text it edits", async () => {
    useStore.getState().setComposerDraft("s1", { text: "draft", images: [] });
    const edit = { mode: "edit" as const, target: composerTarget("draft"), text: "Draft.", instructionText: "fix" };
    receivePendingVoiceResult("s1", keep({ requestId: "voice-1", ...edit }), 0);
    await vi.runAllTimersAsync();
    expect(useStore.getState().recoveredVoiceEdits.get("s1")).toEqual({
      originalText: "draft",
      editedText: "Draft.",
      instructionText: "fix",
    });

    useStore.getState().setRecoveredVoiceEdit("s1", null);
    useStore.getState().setComposerDraft("s1", { text: "draft, then more", images: [] });
    receivePendingVoiceResult("s1", keep({ requestId: "voice-2", ...edit }), 0);
    await vi.runAllTimersAsync();
    expect(useStore.getState().recoveredVoiceEdits.get("s1")).toBeUndefined();
    expect(composerText()).toBe("draft, then more");
  });
});
