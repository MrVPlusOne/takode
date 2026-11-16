import { describe, expect, it, vi } from "vitest";
import { refreshSlackUpdates, stopWatchingSlack, watchedSlackConversations } from "../slack-conversation-watch.js";
import { createSlackUpdateRoutes } from "./slack-updates.js";

vi.mock("../slack-conversation-watch.js", () => ({
  refreshSlackUpdates: vi.fn(),
  watchedSlackConversations: vi.fn(() => [{ id: "D1", label: "DM", lastReadAt: 1 }]),
  stopWatchingSlack: vi.fn((_id: string, ids: string[] | "all") => (ids === "all" ? ["D1"] : ids)),
}));

// The routes behind `takode slack list|stop` and the question-card refresh, against a minimal bridge.
function setup() {
  const wsBridge = { getSession: (id: string) => (id === "s1" ? { id } : undefined) };
  const app = createSlackUpdateRoutes({
    wsBridge: wsBridge as any,
    resolveId: (raw) => raw,
    authenticateTakodeCaller: (() => ({ callerId: "s1" })) as any,
  });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, post };
}

describe("Slack update routes", () => {
  it("checks a session's conversations when one of its questions is opened", async () => {
    const { post } = setup();
    expect((await post("/sessions/s1/slack-refresh")).status).toBe(200);
    expect(refreshSlackUpdates).toHaveBeenCalledWith("s1");
    expect((await post("/sessions/nope/slack-refresh")).status).toBe(404);
  });

  it("lists and stops the conversations a session watches", async () => {
    const { app, post } = setup();
    expect(await (await app.request("/sessions/s1/slack-watch")).json()).toEqual({
      conversations: [{ id: "D1", label: "DM", lastReadAt: 1 }],
    });
    expect(watchedSlackConversations).toHaveBeenCalledWith("s1");

    expect(await (await post("/sessions/s1/slack-watch/stop", { ids: ["C1/1.000001"] })).json()).toEqual({
      stopped: ["C1/1.000001"],
    });
    expect(await (await post("/sessions/s1/slack-watch/stop", { all: true })).json()).toEqual({ stopped: ["D1"] });
    expect(stopWatchingSlack).toHaveBeenLastCalledWith("s1", "all");
    // Stopping nothing is a mistake worth reporting, not a silent success.
    expect((await post("/sessions/s1/slack-watch/stop", { ids: [] })).status).toBe(400);
  });
});
