import { describe, expect, it, vi } from "vitest";
import { backendAttached, killSession } from "./session-registry-controller.js";

describe("killSession", () => {
  // A stopped Claude session must not keep its old adapter attached: input
  // routed to a stopped adapter waits inside it and never asks for a relaunch,
  // while a session without an adapter queues the input and relaunches.
  it("ends the Claude adapter and detaches it from the session", async () => {
    const disconnect = vi.fn(async () => {});
    const session = { claudeSdkAdapter: { disconnect }, codexAdapter: null, cliInitReceived: true };
    const killLauncher = vi.fn(async () => true);

    await expect(killSession(new Map([["s1", session]]), "s1", { killLauncher })).resolves.toBe(true);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(killLauncher).toHaveBeenCalledWith("s1");
    expect(backendAttached(session)).toBe(false);
    expect(session.cliInitReceived).toBe(false);
  });
});
