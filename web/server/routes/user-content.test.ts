import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { UserContentService } from "../user-content-service.js";
import { createUserContentRoutes, USER_CONTENT_SETUP_PROMPT } from "./user-content.js";

// The Settings entry point hands the work to an agent; these routes are what it and the agent call.
type Send = Parameters<typeof createUserContentRoutes>[1];

function app(sendToSession: Send = vi.fn(() => "sent" as const), service: Partial<UserContentService> = {}) {
  const hono = new Hono();
  hono.route("/api", createUserContentRoutes(service as UserContentService, sendToSession));
  return hono;
}

const post = (path: string, body: unknown) =>
  new Request(`http://x/api${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("user content routes", () => {
  it("sends the picked session the setup prompt, and refuses one that cannot receive it", async () => {
    const sendToSession = vi.fn(() => "sent" as const);
    const response = await app(sendToSession).fetch(post("/user-content/agent-setup", { sessionId: "s1" }));
    expect(response.status).toBe(200);
    expect(sendToSession).toHaveBeenCalledWith("s1", USER_CONTENT_SETUP_PROMPT);

    const missing = await app(vi.fn(() => "no_session" as const)).fetch(
      post("/user-content/agent-setup", { sessionId: "x" }),
    );
    expect(missing.status).toBe(409);
  });

  it("passes the machine, skill names and dangling choice to the removal", async () => {
    const retireSkills = vi.fn(async () => ({ moved: [], skipped: [] }));
    const response = await app(undefined, { retireSkills } as never).fetch(
      post("/user-content/remove-skills", { hostId: "h1", skills: ["hq-notes", 3], dangling: true }),
    );
    expect(response.status).toBe(200);
    expect(retireSkills).toHaveBeenCalledWith("h1", ["hq-notes"], true);
  });
});
