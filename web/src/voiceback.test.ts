// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, SessionNotification } from "./types.js";

/**
 * A stand-in Read aloud player: the test decides when a read finishes, fails or is stopped, and
 * sees what was started, so the queue can be checked without audio.
 */
const fakePlayer = vi.hoisted(() => {
  type Read = { messageId: string; sessionId: string; status: "preparing" | "ready" | "error"; ended: boolean };
  const listeners = new Set<() => void>();
  const endListeners = new Set<(messageId: string) => void>();
  const fake = {
    read: null as Read | null,
    started: [] as Array<{ messageId: string; text: string }>,
    unlocks: 0,
    notify: () => listeners.forEach((listener) => listener()),
    finish() {
      fake.read!.ended = true;
      fake.notify();
      const id = fake.read!.messageId;
      endListeners.forEach((listener) => listener(id));
    },
    fail() {
      fake.read = { ...fake.read!, status: "error" };
      fake.notify();
    },
    stop() {
      fake.read = null;
      fake.notify();
    },
    module: {
      startReadAloud: (input: { sessionId: string; messageId: string; text: string }) => {
        fake.read = null;
        fake.notify();
        fake.started.push({ messageId: input.messageId, text: input.text });
        fake.read = { messageId: input.messageId, sessionId: input.sessionId, status: "preparing", ended: false };
        fake.notify();
      },
      stopReadAloud: () => fake.stop(),
      unlockReadAloudAudio: () => void fake.unlocks++,
      isReadAloudBusy: () => !!fake.read && fake.read.status !== "error" && !fake.read.ended,
      getReadAloudState: () => fake.read,
      subscribeReadAloud: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onReadAloudEnd: (listener: (messageId: string) => void) => {
        endListeners.add(listener);
        return () => endListeners.delete(listener);
      },
    },
  };
  return fake;
});
vi.mock("./read-aloud-player.js", () => fakePlayer.module);

const wakeLock = vi.hoisted(() => ({ held: 0, release: 0 }));
vi.mock("./utils/screen-wake-lock.js", () => ({
  holdScreenWakeLock: () => {
    wakeLock.held++;
    return () => void wakeLock.release++;
  },
}));

const markNotificationDone = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("./api.js", () => ({ api: { markNotificationDone } }));

import { useStore } from "./store.js";
import { stopVoiceback, toggleVoiceback, useVoiceback } from "./voiceback.js";

const now = Date.now();

function assistant(id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", content: text, timestamp: now, ...extra };
}

/** A leader's unread answer, as the server makes one for a settled answer. */
function answer(id: string, messageId: string, extra: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id,
    category: "review",
    summary: "Answer",
    timestamp: now,
    messageId,
    unreadReason: "answer",
    done: false,
    ...extra,
  } as SessionNotification;
}

function setMessages(sessionId: string, messages: ChatMessage[]) {
  act(() => useStore.getState().setMessages(sessionId, messages));
}

function setNotifications(sessionId: string, notifications: SessionNotification[]) {
  act(() => useStore.getState().setSessionNotifications(sessionId, notifications));
}

beforeEach(() => {
  useStore.getState().reset();
  fakePlayer.read = null;
  fakePlayer.started = [];
  fakePlayer.unlocks = 0;
  wakeLock.held = 0;
  wakeLock.release = 0;
  markNotificationDone.mockClear();
});

afterEach(() => {
  act(() => stopVoiceback());
});

describe("voiceback for a leader", () => {
  it("reads new answers in arrival order, one after another, marking each read once it ends", () => {
    // An answer already unread when voiceback starts is not new: only later arrivals are read.
    setMessages("lead", [assistant("m-old", "Old answer")]);
    setNotifications("lead", [answer("n-1", "m-old")]);
    act(() => toggleVoiceback("lead", true));

    setMessages("lead", [assistant("m-old", "Old answer"), assistant("m-a", "First"), assistant("m-b", "Second")]);
    setNotifications("lead", [answer("n-1", "m-old"), answer("n-2", "m-a"), answer("n-3", "m-b")]);

    // The first plays at once; the second waits instead of cutting it off.
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["First"]);
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toEqual({ sessionId: "lead", waiting: 1 });

    act(() => fakePlayer.finish());
    expect(markNotificationDone).toHaveBeenCalledWith("lead", "n-2", true);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["First", "Second"]);

    act(() => fakePlayer.finish());
    expect(markNotificationDone).toHaveBeenCalledWith("lead", "n-3", true);
    expect(markNotificationDone).toHaveBeenCalledTimes(2);
  });

  it("waits for an answer's message to reach the browser before reading it", () => {
    act(() => toggleVoiceback("lead", true));
    setNotifications("lead", [answer("n-1", "m-a")]);
    expect(fakePlayer.started).toEqual([]);

    setMessages("lead", [assistant("m-a", "Here it is")]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Here it is"]);
  });

  it("does not mark a read that was stopped or failed, and goes on to the next", () => {
    act(() => toggleVoiceback("lead", true));
    setMessages("lead", [assistant("m-a", "A"), assistant("m-b", "B"), assistant("m-c", "C")]);
    setNotifications("lead", [answer("n-1", "m-a"), answer("n-2", "m-b"), answer("n-3", "m-c")]);

    act(() => fakePlayer.stop());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["A", "B"]);
    act(() => fakePlayer.fail());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["A", "B", "C"]);
    expect(markNotificationDone).not.toHaveBeenCalled();
  });

  it("leaves a read the user started alone and continues once it ends", () => {
    act(() => toggleVoiceback("lead", true));
    // The user reads some other message by hand.
    act(() => fakePlayer.module.startReadAloud({ sessionId: "lead", messageId: "m-mine", text: "Mine" }));
    setMessages("lead", [assistant("m-a", "New")]);
    setNotifications("lead", [answer("n-1", "m-a")]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Mine"]);

    act(() => fakePlayer.finish());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Mine", "New"]);
  });

  it("ignores answers from before it started that show up later, and read or non-answer results", () => {
    act(() => toggleVoiceback("lead", true));
    setMessages("lead", [assistant("m-a", "A"), assistant("m-b", "B"), assistant("m-c", "C")]);
    setNotifications("lead", [
      // Loaded after a reconnect, but written long before voiceback started.
      answer("n-1", "m-a", { timestamp: now - 60 * 60_000 }),
      // Already read elsewhere.
      answer("n-2", "m-b", { done: true }),
      // A finished quest has no message of its own to read.
      answer("n-3", "m-c", { unreadReason: "quest-complete" }),
    ]);
    expect(fakePlayer.started).toEqual([]);
  });
});

describe("voiceback for other sessions", () => {
  it("reads the message each turn ends on, not the ones before it or tool-only ends", () => {
    setMessages("w", [assistant("m-0", "Earlier turn", { turnDurationMs: 1_000 })]);
    act(() => toggleVoiceback("w", false));

    // A running turn: its messages are not final yet.
    setMessages("w", [assistant("m-0", "Earlier turn", { turnDurationMs: 1_000 }), assistant("m-1", "Working on it")]);
    expect(fakePlayer.started).toEqual([]);

    // The server stamps the turn's duration on the message it ended on.
    act(() => useStore.getState().updateMessage("w", "m-1", { turnDurationMs: 9_000 }));
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Working on it"]);

    // A turn ending on a message with no text has nothing to read.
    setMessages("w", [
      assistant("m-0", "Earlier turn", { turnDurationMs: 1_000 }),
      assistant("m-1", "Working on it", { turnDurationMs: 9_000 }),
      assistant("m-2", "", { turnDurationMs: 2_000, contentBlocks: [] }),
    ]);
    expect(fakePlayer.started).toHaveLength(1);
  });
});

describe("turning voiceback on and off", () => {
  it("keeps the screen awake and unlocks audio from the tap, and lets both go when turned off", () => {
    act(() => toggleVoiceback("w", false));
    expect(wakeLock.held).toBe(1);
    expect(fakePlayer.unlocks).toBe(1);

    act(() => toggleVoiceback("w", false));
    expect(wakeLock.release).toBe(1);
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toBeNull();
  });

  it("stops the read it started when turned off, and reads nothing more", () => {
    act(() => toggleVoiceback("lead", true));
    setMessages("lead", [assistant("m-a", "A"), assistant("m-b", "B")]);
    setNotifications("lead", [answer("n-1", "m-a"), answer("n-2", "m-b")]);
    expect(fakePlayer.read?.messageId).toBe("m-a");

    act(() => stopVoiceback());
    expect(fakePlayer.read).toBeNull();
    expect(fakePlayer.started).toHaveLength(1);
  });

  it("moves to another session when turned on there", () => {
    act(() => toggleVoiceback("a", false));
    act(() => toggleVoiceback("b", false));
    const { result } = renderHook(() => useVoiceback());
    expect(result.current?.sessionId).toBe("b");
    // The first session's screen lock was let go before the second took its own.
    expect(wakeLock.held).toBe(2);
    expect(wakeLock.release).toBe(1);
  });
});
