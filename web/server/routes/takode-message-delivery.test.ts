import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MessageDeliveryTracker, type DeliveryProbe } from "../message-delivery-tracker.js";
import { createTakodeRoutes } from "./takode.js";

// `takode send` asks the message route to track a message that could only be
// queued; the sender's CLI then polls the status route during the wait window.

function createTestApp(options: {
  delivery?: "sent" | "queued";
  caller?: { id: string; isOrchestrator: boolean };
  tracker?: MessageDeliveryTracker;
}) {
  let probe: DeliveryProbe = { kind: "waiting", reason: "the session is starting", wait: "starting" };
  const tracker = options.tracker ?? new MessageDeliveryTracker({ probe: async () => probe, notifySender: vi.fn() });
  const caller = options.caller ?? { id: "orch-1", isOrchestrator: true };
  const session = { id: "worker-1", state: { pause: null }, messageHistory: [] };
  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher: {
        resolveSessionId: (id: string) => id,
        getSession: (id: string) => ({ sessionId: id, herdedBy: "orch-1" }),
      },
      wsBridge: { getSession: () => session, injectUserMessage: vi.fn(() => options.delivery ?? "queued") },
      authenticateTakodeCaller: () => ({
        callerId: caller.id,
        caller: { sessionId: caller.id, isOrchestrator: caller.isOrchestrator },
      }),
      resolveId: (id: string) => id,
      options: { messageDeliveries: tracker },
    } as any),
  );
  const send = async (body: Record<string, unknown>) =>
    (await app.request("/api/sessions/worker-1/message", { method: "POST", body: JSON.stringify(body) })).json();
  return { app, tracker, send, setProbe: (next: DeliveryProbe) => (probe = next) };
}

describe("message delivery tracking routes", () => {
  it("tracks a queued message when asked and serves its status to the sender", async () => {
    const { app, tracker, send, setProbe } = createTestApp({});
    const body = (await send({ content: "Take over the handover", trackDelivery: true })) as any;
    expect(body).toMatchObject({
      delivery: "queued",
      messageDelivery: { status: "pending", senderSessionId: "orch-1", targetSessionId: "worker-1", followUp: true },
    });

    setProbe({ kind: "delivered" });
    const status = await app.request(`/api/takode/messages/${body.messageDelivery.id}`);
    expect(await status.json()).toMatchObject({ id: body.messageDelivery.id, status: "delivered" });
    tracker.dispose();
  });

  it("does not track messages that reached a running backend or did not ask for tracking", async () => {
    const sent = createTestApp({ delivery: "sent" });
    expect(await sent.send({ content: "hi", trackDelivery: true })).toEqual({
      ok: true,
      sessionId: "worker-1",
      delivery: "sent",
    });
    const untracked = createTestApp({});
    expect(await untracked.send({ content: "hi" })).not.toHaveProperty("messageDelivery");
  });

  it("hides a message's status from sessions that are neither its sender nor a leader", async () => {
    const { tracker } = createTestApp({});
    const record = tracker.track({
      targetSessionId: "worker-1",
      senderSessionId: "orch-1",
      content: "x",
      followUp: true,
    });
    const worker = createTestApp({ tracker, caller: { id: "worker-2", isOrchestrator: false } });
    expect((await worker.app.request(`/api/takode/messages/${record.id}`)).status).toBe(404);
    const otherLeader = createTestApp({ tracker, caller: { id: "orch-2", isOrchestrator: true } });
    expect((await otherLeader.app.request(`/api/takode/messages/${record.id}`)).status).toBe(200);
    tracker.dispose();
  });
});
