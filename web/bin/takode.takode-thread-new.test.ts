import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `takode thread new`: a leader opens a thread of its own for a proposal or question that has no
 * quest, topic or thread yet, so it doesn't end up in Main. The CLI asks the server for the thread
 * as the calling leader and prints the key to write and ask in.
 */
type JsonObject = Record<string, unknown>;

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as JsonObject;
}

async function runTakode(args: string[], port: number) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./takode.ts", import.meta.url)), ...args, "--port", String(port)],
    {
      env: { ...process.env, COMPANION_SESSION_ID: "leader-1", COMPANION_AUTH_TOKEN: "auth-1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const [status] = await once(child, "close");
  return { status, stdout, stderr };
}

describe("takode thread new", () => {
  let server: Server;
  let port: number;
  let calls: JsonObject[];

  beforeEach(async () => {
    calls = [];
    server = createServer(async (req, res) => {
      // Leader commands check the caller is a leader first.
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-1", isOrchestrator: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/topics/threads") {
        const body = await readJson(req);
        calls.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            thread: {
              key: "topic:88beef00",
              name: body.name,
              ...(body.topic ? { topic: { id: "t1", name: body.topic } } : {}),
            },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/api/sessions/leader-1/thread/attach") {
        const body = await readJson(req);
        calls.push({ attach: body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, attached: [body.message], alreadyAttached: [], outOfRange: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.close();
    await once(server, "close");
  });

  it("opens a thread for the calling leader, under a topic, and says how to write and ask there", async () => {
    const result = await runTakode(["thread", "new", "Faster eval sweeps", "--topic", "T7 run"], port);
    expect(result.status).toBe(0);
    expect(calls).toEqual([{ leader: "leader-1", name: "Faster eval sweeps", topic: "T7 run" }]);
    expect(result.stdout).toContain('Started the thread "Faster eval sweeps" (topic:88beef00) under "T7 run".');
    expect(result.stdout).toContain("[thread:topic:88beef00:A]");
    expect(result.stdout).toContain("--thread topic:88beef00");
  });

  it("starts the thread with the message that prompted it", async () => {
    // Another leader's message prompted the thread: carried in, it is the first thing the user
    // reads there instead of staying behind in Main.
    const result = await runTakode(["thread", "new", "--from", "4182", "Fresher Slack updates"], port);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      { leader: "leader-1", name: "Fresher Slack updates" },
      { attach: { questId: "topic:88beef00", message: 4182 } },
    ]);
    expect(result.stdout).toContain("It starts with message 4182.");
  });

  it("refuses a --from that is not a message index before opening anything", async () => {
    const result = await runTakode(["thread", "new", "Fresher Slack updates", "--from", "latest"], port);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--from takes the message's index");
    expect(calls).toEqual([]);
  });

  it("needs a name", async () => {
    const result = await runTakode(["thread", "new", "--topic", "T7 run"], port);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage: takode thread new");
    expect(calls).toEqual([]);
  });
});
