import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { forkSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

type StoreEntry = SessionStoreEntry & Record<string, unknown>;

function textOf(message: unknown): string | undefined {
  const content = (message as { message?: { content?: Array<{ text?: string }> } })?.message?.content;
  return content?.[0]?.text;
}

function makeUser(sessionId: string, uuid: string, text: string, parentUuid?: string): StoreEntry {
  return {
    type: "user",
    uuid,
    ...(parentUuid ? { parentUuid } : {}),
    sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function makeAssistant(sessionId: string, uuid: string, text: string, parentUuid: string): StoreEntry {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    sessionId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { id: `msg-${uuid}`, role: "assistant", content: [{ type: "text", text }] },
  };
}

function createInMemorySessionStore(initial: Record<string, StoreEntry[]>) {
  const sessions = new Map(Object.entries(initial).map(([sessionId, entries]) => [sessionId, entries.slice()]));
  const appendCalls: Array<{ key: SessionKey; entries: SessionStoreEntry[] }> = [];

  return {
    sessions,
    appendCalls,
    store: {
      append: async (key, entries) => {
        appendCalls.push({ key, entries });
        sessions.set(key.sessionId, [...(sessions.get(key.sessionId) ?? []), ...entries] as StoreEntry[]);
      },
      load: async (key) => sessions.get(key.sessionId) ?? null,
      listSessions: async () => [...sessions.keys()].map((sessionId) => ({ sessionId, mtime: 1 })),
    } satisfies SessionStore,
  };
}

describe("Claude SDK Side Chat fork harness", () => {
  it("validates local forkSession upToMessageId slicing without live Claude state", async () => {
    // This is intentionally SDK-local: the in-memory SessionStore exercises the
    // real forkSession transcript mutation path without spawning Claude or
    // reading user credentials from the default ~/.claude state.
    const parentSessionId = randomUUID();
    const userOne = randomUUID();
    const anchorAssistant = randomUUID();
    const userAfterAnchor = randomUUID();
    const assistantAfterAnchor = randomUUID();

    const parentEntries = [
      makeUser(parentSessionId, userOne, "root question one"),
      makeAssistant(parentSessionId, anchorAssistant, "anchor assistant answer", userOne),
      makeUser(parentSessionId, userAfterAnchor, "root question after anchor", anchorAssistant),
      makeAssistant(parentSessionId, assistantAfterAnchor, "assistant answer after anchor", userAfterAnchor),
    ];
    const harness = createInMemorySessionStore({ [parentSessionId]: parentEntries });

    const forked = await forkSession(parentSessionId, {
      dir: process.cwd(),
      upToMessageId: anchorAssistant,
      title: "Side Chat: anchor assistant answer",
      sessionStore: harness.store,
    });

    expect(forked.sessionId).not.toBe(parentSessionId);
    expect(harness.sessions.get(parentSessionId)).toEqual(parentEntries);
    expect(harness.appendCalls).toHaveLength(1);
    expect(harness.appendCalls[0].key.sessionId).toBe(forked.sessionId);

    const parentMessages = await getSessionMessages(parentSessionId, {
      dir: process.cwd(),
      sessionStore: harness.store,
    });
    expect(parentMessages.map(textOf)).toEqual([
      "root question one",
      "anchor assistant answer",
      "root question after anchor",
      "assistant answer after anchor",
    ]);

    const childMessages = await getSessionMessages(forked.sessionId, {
      dir: process.cwd(),
      sessionStore: harness.store,
    });
    expect(childMessages.map(textOf)).toEqual(["root question one", "anchor assistant answer"]);
    expect(childMessages.map((message) => message.uuid)).not.toContain(userOne);
    expect(childMessages.map((message) => message.uuid)).not.toContain(anchorAssistant);

    const childEntries = harness.sessions.get(forked.sessionId) ?? [];
    expect(childEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "custom-title", customTitle: "Side Chat: anchor assistant answer" }),
      ]),
    );
    expect(childEntries.map(textOf)).not.toContain("root question after anchor");
    expect(childEntries.map(textOf)).not.toContain("assistant answer after anchor");
  });
});
