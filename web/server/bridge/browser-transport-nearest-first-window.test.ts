import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendThreadWindowSync } from "./browser-transport-controller.js";

type ThreadWindowSync = Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>;

// Twelve Main-thread requests, each its own conversation item, so a 9-item window
// around a target leaves conversations out on both sides.
function makeSession(id: string) {
  return {
    id,
    messageHistory: Array.from(
      { length: 12 },
      (_, index): BrowserIncomingMessage => ({
        type: "user_message",
        id: `message-${index}`,
        content: `Request ${index}`,
        timestamp: 1_700_000_000_000 + index,
        threadKey: "main",
      }),
    ),
  };
}

function receive(
  session: ReturnType<typeof makeSession>,
  options: { targetMessageId?: string; cachedWindowHash?: string; fromItem?: number },
): ThreadWindowSync[] {
  const send = vi.fn();
  sendThreadWindowSync(
    session,
    { send },
    {
      threadKey: "main",
      fromItem: options.fromItem ?? -1,
      itemCount: 9,
      sectionItemCount: 3,
      visibleItemCount: 3,
      targetMessageId: options.targetMessageId,
      cachedWindowHash: options.cachedWindowHash,
    },
  );
  return send.mock.calls.map(([json]) => JSON.parse(json as string) as ThreadWindowSync);
}

const messageIds = (sync: ThreadWindowSync) => sync.entries.map((entry) => (entry.message as { id?: string }).id ?? "");

describe("nearest-first thread windows for message jumps", () => {
  it("sends the conversations around the target first, then the full window", () => {
    // A jump to a message the browser does not hold: the small window lets the
    // browser show the target before the full window is built, sent and rendered.
    const [near, full, ...rest] = receive(makeSession("nearest-first-jump"), { targetMessageId: "message-6" });
    expect(rest).toHaveLength(0);

    expect(near.window.partial).toBe(true);
    expect(messageIds(near)).toEqual(["message-5", "message-6", "message-7"]);
    // Sent whole: the browser keeps it only until the full window replaces it.
    expect(near.entries_delta).toBeUndefined();
    expect(near.window.has_older_items).toBe(true);
    expect(near.window.has_newer_items).toBe(true);

    expect(full.window.partial).toBeUndefined();
    expect(full.window.item_count).toBe(9);
    expect(messageIds(full)).toContain("message-6");
    expect(full.window.window_hash).not.toBe(near.window.window_hash);
  });

  it("sends only the full window when the browser may already hold the target", () => {
    // Revalidating a window that has the target usually ends in a small cache hit;
    // a partial window first would replace what is on screen with less.
    const session = makeSession("nearest-first-held-target");
    const [, full] = receive(session, { targetMessageId: "message-6" });
    const revalidated = receive(session, { targetMessageId: "message-6", cachedWindowHash: full.window.window_hash });
    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]!.cache_hit).toBe(true);

    // A held window the server no longer remembers might have it too.
    const unknownHeld = receive(session, { targetMessageId: "message-6", cachedWindowHash: "forgotten-window" });
    expect(unknownHeld).toHaveLength(1);
    expect(unknownHeld[0]!.window.partial).toBeUndefined();
  });

  it("goes nearest-first from a remembered window that lacks the target", () => {
    // The usual jump: the tab shows the thread's latest window and the target is older.
    const session = makeSession("nearest-first-from-latest");
    const [latest] = receive(session, {});
    expect(messageIds(latest!)).not.toContain("message-1");

    const [near, full] = receive(session, {
      targetMessageId: "message-1",
      cachedWindowHash: latest!.window.window_hash,
    });
    expect(near!.window.partial).toBe(true);
    expect(messageIds(near!)).toEqual(["message-0", "message-1", "message-2"]);
    expect(full!.window.partial).toBeUndefined();
  });

  it("sends a single window without a target, or when the target is not in the thread", () => {
    const session = makeSession("nearest-first-no-target");
    expect(receive(session, {})).toHaveLength(1);
    const missing = receive(session, { targetMessageId: "missing-message" });
    expect(missing).toHaveLength(1);
    expect(missing[0]!.window.partial).toBeUndefined();
  });
});
