import { afterEach, expect, it, vi } from "vitest";

import { serverWorkAdmission } from "./server-work-admission.js";
import { RelaunchQueue } from "./relaunch-queue.js";
import { CliLauncher } from "./cli-launcher.js";
import { CodexAdapter } from "./codex-adapter.js";
import { JsonRpcTransport } from "./codex-jsonrpc-transport.js";
import { dispatchQueuedCodexTurns } from "./bridge/codex-turn-queue.js";
import { WsBridge } from "./ws-bridge.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { handleBrowserMessage } from "./bridge/browser-transport-controller.js";
import { deliverProgrammaticUserMessage } from "./bridge/programmatic-user-message-delivery.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
function stopping() {
  vi.spyOn(serverWorkAdmission, "isStopping").mockReturnValue(true);
}

it("refuses new launch/relaunch without changing the saved thread or signaling a process", async () => {
  // The gate precedes launch setup and persisted-PID termination.
  stopping();
  const launcher = new CliLauncher(0);
  const info = { sessionId: "saved", cliSessionId: "existing-thread", pid: 12345, state: "connected" };
  (launcher as any).sessions.set("saved", info);
  const signal = vi.spyOn(process, "kill");
  await expect(launcher.launch({ backendType: "codex" })).rejects.toThrow("shutting down");
  expect(await launcher.relaunch("saved")).toEqual({ ok: false, error: "Server is shutting down" });
  expect(info.cliSessionId).toBe("existing-thread");
  expect(signal).not.toHaveBeenCalled();
});

it("does not run trailing recovery demand after shutdown starts", async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => {});
  const queue = new RelaunchQueue(run, 10);
  queue.request("session");
  queue.request("session");
  await vi.advanceTimersByTimeAsync(1);
  stopping();
  queue.request("other-session");
  await vi.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledExactlyOnceWith("session");
});

it("leaves accepted Codex and Claude queue entries intact", () => {
  stopping();
  const turn = { status: "queued", dispatchCount: 0, adapterMsg: { type: "user_message", content: "accepted" } };
  const send = vi.fn();
  const codex = {
    pendingCodexTurns: [turn],
    codexAdapter: { isConnected: () => true, sendBrowserMessage: send },
    state: { backend_state: "connected" },
  };
  expect(dispatchQueuedCodexTurns(codex as any, "shutdown", {} as any).status).toBe("noop");
  expect(codex.pendingCodexTurns).toEqual([turn]);
  expect(send).not.toHaveBeenCalled();
  // A Claude process attaching during shutdown must not drain accepted input.
  const raw = JSON.stringify({ type: "user_message", content: "accepted" });
  const bridge = new WsBridge();
  const claude = bridge.getOrCreateSession("claude-shutdown");
  claude.pendingMessages.push(raw);
  const backend = createClaudeSdkTestBackend("claude-shutdown").attach(bridge);
  expect(claude.pendingMessages).toEqual([raw]);
  expect(backend.outgoing).toEqual([]);
  expect(backend.userTurns).not.toHaveBeenCalled();
});

it("refuses backend dispatch even when an earlier async handler reaches the transport later", async () => {
  stopping();
  expect(CodexAdapter.prototype.sendBrowserMessage.call({} as any, { type: "user_message", content: "pending" })).toBe(
    false,
  );
  const transport = Object.create(JsonRpcTransport.prototype);
  transport.nextId = 0;
  await expect(transport.call("turn/start", { threadId: "original" })).rejects.toThrow("dispatch deferred");
  await expect(transport.call("turn/steer", { threadId: "original" })).rejects.toThrow("dispatch deferred");
});

it("rejects fresh input before recording a client acknowledgement or consuming a programmatic delivery", () => {
  stopping();
  const ws = { send: vi.fn() } as any;
  const session = { id: "test", processedClientMessageIds: [] } as any;
  const result = handleBrowserMessage(session, '{"type":"user_message","client_msg_id":"input"}', ws, {} as any);
  expect(result.messageType).toBe("shutdown_rejected");
  expect(session.processedClientMessageIds).toEqual([]);
  const accepted = vi.fn();
  const rejected = vi.fn();
  expect(
    deliverProgrammaticUserMessage(
      session,
      "new",
      undefined,
      undefined,
      undefined,
      { afterAccepted: accepted, afterRejected: rejected },
      {} as any,
    ),
  ).toBe("dropped");
  expect(accepted).not.toHaveBeenCalled();
  expect(rejected).toHaveBeenCalledWith("route_rejected");
});
