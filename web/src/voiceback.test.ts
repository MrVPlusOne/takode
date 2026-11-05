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
    /** Whether the page may play audio without a tap (false is iPhone Safari after a reload). */
    autoplay: true,
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
      unlockReadAloudAudio: () => {
        fake.unlocks++;
        return Promise.resolve(fake.autoplay);
      },
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
import { restoreVoiceback, toggleVoiceback, useVoiceback } from "./voiceback.js";

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

/** Show `sessionId`, as opening it in the app does; voiceback follows the session on screen. */
function view(sessionId: string) {
  act(() => useStore.getState().setCurrentSession(sessionId));
}

/** Turn voiceback on or off with the composer's toggle. */
function tap() {
  act(() => toggleVoiceback());
}

/** A needs-input question as `takode notify needs-input` makes one, with its context message. */
function question(id: string, extra: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id,
    category: "needs-input",
    summary: "Batch 2: what to do?",
    questionOnly: true,
    questions: [
      { prompt: "How should batch 2 handle the 11 tasks?", suggestedAnswers: ["Launch all", "Hold them back"] },
    ],
    timestamp: now,
    messageId: `needs-input-context-${id}`,
    contextMessageId: `needs-input-context-${id}`,
    done: false,
    ...extra,
  } as SessionNotification;
}

beforeEach(() => {
  useStore.getState().reset();
  localStorage.clear();
  // "lead" is a leader; "w", "a" and "b" are ordinary sessions.
  useStore.getState().setSdkSessions([
    { sessionId: "lead", state: "connected", cwd: "/r", createdAt: 1, isOrchestrator: true },
    { sessionId: "w", state: "connected", cwd: "/r", createdAt: 1 },
    { sessionId: "a", state: "connected", cwd: "/r", createdAt: 1 },
    { sessionId: "b", state: "connected", cwd: "/r", createdAt: 1 },
  ] as never);
  fakePlayer.autoplay = true;
  fakePlayer.read = null;
  fakePlayer.started = [];
  fakePlayer.unlocks = 0;
  wakeLock.held = 0;
  wakeLock.release = 0;
  markNotificationDone.mockClear();
});

afterEach(() => {
  if (localStorage.getItem("cc-voiceback")) tap();
});

describe("voiceback for a leader", () => {
  it("reads new answers in arrival order, one after another, marking each read once it ends", () => {
    // An answer already unread when voiceback starts is not new: only later arrivals are read.
    setMessages("lead", [assistant("m-old", "Old answer")]);
    setNotifications("lead", [answer("n-1", "m-old")]);
    view("lead");
    tap();

    setMessages("lead", [assistant("m-old", "Old answer"), assistant("m-a", "First"), assistant("m-b", "Second")]);
    setNotifications("lead", [answer("n-1", "m-old"), answer("n-2", "m-a"), answer("n-3", "m-b")]);

    // The first plays at once; the second waits instead of cutting it off.
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["First"]);
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toEqual({ waiting: 1, ready: true });

    act(() => fakePlayer.finish());
    expect(markNotificationDone).toHaveBeenCalledWith("lead", "n-2", true);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["First", "Second"]);

    act(() => fakePlayer.finish());
    expect(markNotificationDone).toHaveBeenCalledWith("lead", "n-3", true);
    expect(markNotificationDone).toHaveBeenCalledTimes(2);
  });

  it("waits for an answer's message to reach the browser before reading it", () => {
    view("lead");
    tap();
    setNotifications("lead", [answer("n-1", "m-a")]);
    expect(fakePlayer.started).toEqual([]);

    setMessages("lead", [assistant("m-a", "Here it is")]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Here it is"]);
  });

  it("does not mark a read that was stopped or failed, and goes on to the next", () => {
    view("lead");
    tap();
    setMessages("lead", [assistant("m-a", "A"), assistant("m-b", "B"), assistant("m-c", "C")]);
    setNotifications("lead", [answer("n-1", "m-a"), answer("n-2", "m-b"), answer("n-3", "m-c")]);

    act(() => fakePlayer.stop());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["A", "B"]);
    act(() => fakePlayer.fail());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["A", "B", "C"]);
    expect(markNotificationDone).not.toHaveBeenCalled();
  });

  it("leaves a read the user started alone and continues once it ends", () => {
    view("lead");
    tap();
    // The user reads some other message by hand.
    act(() => fakePlayer.module.startReadAloud({ sessionId: "lead", messageId: "m-mine", text: "Mine" }));
    setMessages("lead", [assistant("m-a", "New")]);
    setNotifications("lead", [answer("n-1", "m-a")]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Mine"]);

    act(() => fakePlayer.finish());
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Mine", "New"]);
  });

  it("ignores answers from before it started that show up later, and read or non-answer results", () => {
    view("lead");
    tap();
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
    view("w");
    tap();

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

describe("questions", () => {
  // Jiayi heard nothing when a leader's reply was a needs-input question (Nov 5): a question is not
  // an unread answer, so the leader's read rules never offered it. It is read in every session.
  it("reads a leader's question: its context message, then the question with its suggested answers", () => {
    view("lead");
    tap();
    setMessages("lead", [assistant("needs-input-context-q1", "Here is the situation.")]);
    setNotifications("lead", [question("q1")]);

    expect(fakePlayer.started).toHaveLength(1);
    const { text, messageId } = fakePlayer.started[0]!;
    expect(messageId).toBe("needs-input-context-q1");
    expect(text).toContain("Here is the situation.");
    expect(text).toContain("How should batch 2 handle the 11 tasks?");
    expect(text).toContain("Launch all; Hold them back");

    // A question is answered, not read: reading it does not mark it done.
    act(() => fakePlayer.finish());
    expect(markNotificationDone).not.toHaveBeenCalled();
  });

  it("waits for the question's context message, and skips questions already answered", () => {
    view("lead");
    tap();
    setNotifications("lead", [question("q1"), question("q2", { done: true })]);
    expect(fakePlayer.started).toEqual([]);

    setMessages("lead", [
      assistant("needs-input-context-q1", "Context"),
      assistant("needs-input-context-q2", "Old context"),
    ]);
    expect(fakePlayer.started.map((read) => read.messageId)).toEqual(["needs-input-context-q1"]);
  });

  it("reads a question in an ordinary session, without reading its context again as a turn end", () => {
    view("w");
    tap();
    setMessages("w", [assistant("needs-input-context-q1", "Context", { turnDurationMs: 4_000 })]);
    setNotifications("w", [question("q1")]);
    act(() => fakePlayer.finish());
    expect(fakePlayer.started.map((read) => read.messageId)).toEqual(["needs-input-context-q1"]);
    expect(fakePlayer.started[0]!.text).toContain("<question>");
  });
});

describe("turning voiceback on and off", () => {
  it("keeps the screen awake and unlocks audio from the tap, and lets both go when turned off", () => {
    view("w");
    tap();
    expect(wakeLock.held).toBe(1);
    expect(fakePlayer.unlocks).toBe(1);

    tap();
    expect(wakeLock.release).toBe(1);
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toBeNull();
  });

  it("stops the read it started when turned off, and reads nothing more", () => {
    view("lead");
    tap();
    setMessages("lead", [assistant("m-a", "A"), assistant("m-b", "B")]);
    setNotifications("lead", [answer("n-1", "m-a"), answer("n-2", "m-b")]);
    expect(fakePlayer.read?.messageId).toBe("m-a");

    tap();
    expect(fakePlayer.read).toBeNull();
    expect(fakePlayer.started).toHaveLength(1);
  });

  it("stays on in every session and follows the one on screen", () => {
    view("a");
    tap();
    view("b");
    // Only replies arriving after it watched a session are new there.
    setMessages("b", [assistant("b-1", "From b", { turnDurationMs: 1_000 })]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["From b"]);
    act(() => fakePlayer.finish());

    // A reply in a session not on screen waits until the user comes back to it.
    setMessages("a", [assistant("a-1", "From a", { turnDurationMs: 1_000 })]);
    expect(fakePlayer.started).toHaveLength(1);
    view("a");
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["From b", "From a"]);
    expect(wakeLock.held).toBe(1);
  });
});

describe("staying on across reloads", () => {
  it("remembers the toggle on this device", () => {
    view("w");
    tap();
    expect(localStorage.getItem("cc-voiceback")).toBe("1");
    tap();
    expect(localStorage.getItem("cc-voiceback")).toBeNull();
  });

  it("comes back on after a reload, and plays once the first tap lets the page play audio", async () => {
    // iPhone Safari after a reload: no audio and no screen lock until the user taps somewhere.
    fakePlayer.autoplay = false;
    localStorage.setItem("cc-voiceback", "1");
    view("w");
    const unwatch = restoreVoiceback();
    await act(() => Promise.resolve());
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toEqual({ waiting: 0, ready: false });

    setMessages("w", [assistant("m-1", "Reply", { turnDurationMs: 1_000 })]);
    expect(fakePlayer.started).toEqual([]);
    expect(result.current).toEqual({ waiting: 1, ready: false });

    act(() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(wakeLock.held).toBe(1);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Reply"]);
    unwatch();
  });

  it("plays at once after a reload where the browser allows audio without a tap", async () => {
    localStorage.setItem("cc-voiceback", "1");
    view("w");
    const unwatch = restoreVoiceback();
    await act(() => Promise.resolve());
    setMessages("w", [assistant("m-1", "Reply", { turnDurationMs: 1_000 })]);
    expect(fakePlayer.started.map((read) => read.text)).toEqual(["Reply"]);
    unwatch();
  });

  it("turns off when another tab turns it off", () => {
    view("w");
    tap();
    localStorage.removeItem("cc-voiceback");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "cc-voiceback", newValue: null })));
    const { result } = renderHook(() => useVoiceback());
    expect(result.current).toBeNull();
  });
});
