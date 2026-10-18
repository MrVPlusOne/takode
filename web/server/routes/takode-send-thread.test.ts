import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// Only q-12 and q-13 exist in this quest store.
vi.mock("../quest-store.js", () => ({
  getQuest: vi.fn(async (questId: string) => (["q-12", "q-13"].includes(questId) ? { questId } : null)),
}));

import { createTakodeRoutes } from "./takode.js";

// `takode send --thread` names the receiving leader's thread. The route files the
// message under it, falls back to Main for a quest that does not exist, and flags a
// quest missing from a leader recipient's board so the sender can notice a mix-up.
// Without a named thread, the old text guess still applies (older CLIs, API callers).

function createTestApp(recipient: { isOrchestrator: boolean }) {
  const injectUserMessage = vi.fn(() => "sent");
  const session = {
    id: "leader-b",
    state: { pause: null },
    messageHistory: [],
    board: new Map([["q-12", {}]]),
    completedBoard: new Map(),
  };
  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher: {
        resolveSessionId: (id: string) => id,
        getSession: (id: string) => ({
          sessionId: id,
          isOrchestrator: recipient.isOrchestrator,
        }),
      },
      wsBridge: { getSession: () => session, injectUserMessage },
      authenticateTakodeCaller: () => ({
        callerId: "leader-a",
        caller: { sessionId: "leader-a", isOrchestrator: true },
      }),
      resolveId: (id: string) => id,
      options: {},
    } as any),
  );
  const send = async (body: Record<string, unknown>) => {
    const res = await app.request("/api/sessions/leader-b/message", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const routed = injectUserMessage.mock.calls.at(-1) as unknown[] | undefined;
    return {
      body: (await res.json()) as Record<string, unknown>,
      route: routed?.[4],
    };
  };
  return { send };
}

describe("takode send thread routes", () => {
  it("files the message under a named quest on the recipient's board", async () => {
    const { send } = createTestApp({ isOrchestrator: true });
    const result = await send({
      content: "update about q-12, q-13 and q-14",
      threadKey: "q-12",
    });
    expect(result.body.thread).toEqual({ threadKey: "q-12" });
    expect(result.route).toMatchObject({ threadKey: "q-12", questId: "q-12" });
  });

  it("flags a named quest that is not on a leader recipient's board but still files it there", async () => {
    // A handoff names a quest the recipient does not run yet, so this is a note, not a fallback.
    const { send } = createTestApp({ isOrchestrator: true });
    const result = await send({
      content: "please take q-13",
      threadKey: "q-13",
    });
    expect(result.body.thread).toEqual({
      threadKey: "q-13",
      notOnRecipientBoard: true,
    });
    expect(result.route).toMatchObject({ threadKey: "q-13" });
  });

  it("falls back to Main for a quest that does not exist", async () => {
    const { send } = createTestApp({ isOrchestrator: true });
    const result = await send({ content: "about q-12", threadKey: "q-999" });
    expect(result.body.thread).toEqual({
      threadKey: "main",
      questNotFound: "q-999",
    });
    expect(result.route).toEqual({ threadKey: "main" });
  });

  it("files under Main when the sender names main, even if the text names one quest", async () => {
    const { send } = createTestApp({ isOrchestrator: true });
    const result = await send({ content: "my q-13 landed", threadKey: "main" });
    expect(result.body.thread).toEqual({ threadKey: "main" });
    expect(result.route).toEqual({ threadKey: "main" });
  });

  it("keeps the text guess when no thread is named and reports no thread", async () => {
    const { send } = createTestApp({ isOrchestrator: true });
    const result = await send({ content: "q-13 landed" });
    expect(result.body).not.toHaveProperty("thread");
    expect(result.route).toMatchObject({ threadKey: "q-13" });
  });

  it("does not check the board for recipients that are not leaders", async () => {
    const { send } = createTestApp({ isOrchestrator: false });
    const result = await send({ content: "hi", threadKey: "q-13" });
    expect(result.body.thread).toEqual({ threadKey: "q-13" });
  });
});
