import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// `takode send` must report what really happened to a message for a session
// that was not running: it polls the server's delivery record during the short
// wait window and prints delivered, NOT delivered (exit 1) or still queued.

type Delivery = {
  id: string;
  status: string;
  reason?: string;
  queuedAt: number;
  settledAt?: number;
  followUp: boolean;
};

async function sendWithDeliveries(deliveries: Delivery[], sessionDelivery = "queued") {
  const statusReads: string[] = [];
  const server = createServer(async (req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = req.url || "";
    if (url === "/api/takode/me") return json({ sessionId: "leader-a", isOrchestrator: true });
    // A peer leader target keeps the CLI's herd checks out of the way.
    if (url === "/api/sessions/leader-b") return json({ sessionId: "leader-b", sessionNum: 22, isOrchestrator: true });
    if (url === "/api/takode/sessions") return json([{ sessionId: "leader-a", sessionNum: 21, name: "Leader A" }]);
    if (url === "/api/sessions/leader-b/message") {
      req.resume();
      return json({ ok: true, sessionId: "leader-b", delivery: sessionDelivery, messageDelivery: deliveries[0] });
    }
    if (url === "/api/takode/messages/msg-1") {
      statusReads.push(url);
      return json(deliveries[Math.min(statusReads.length, deliveries.length - 1)]);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./takode.ts", import.meta.url)),
        "send",
        "leader-b",
        "take",
        "over",
        "--port",
        String(port),
      ],
      {
        env: { ...process.env, COMPANION_SESSION_ID: "leader-a", COMPANION_AUTH_TOKEN: "auth-a" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    const [status] = await once(child, "close");
    return { status: status as number | null, stdout, statusReads: statusReads.length };
  } finally {
    server.close();
  }
}

const pending = { id: "msg-1", status: "pending", reason: "the session is starting", queuedAt: 1_000, followUp: true };

describe("takode send delivery reporting", () => {
  it("waits for a relaunching session and reports the delivery", async () => {
    const result = await sendWithDeliveries([pending, { ...pending, status: "delivered", settledAt: 7_000 }]);
    expect(result.status).toBe(0);
    expect(result.statusReads).toBe(1);
    expect(result.stdout).toContain("Message to session leader-b delivered after the session started (6s)");
  });

  it("exits non-zero with the reason when delivery fails", async () => {
    const failed = { ...pending, status: "failed", reason: "relaunch failed: Working directory not found: /x" };
    const result = await sendWithDeliveries([pending, failed]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Message to session leader-b NOT delivered: relaunch failed: Working directory not found: /x. It stays queued there",
    );
  });

  it("says a message is still queued, and why, when the wait window ends first", async () => {
    const queued = { ...pending, status: "queued", reason: "host devbox is offline" };
    const result = await sendWithDeliveries([pending, queued]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("queued, NOT delivered yet: host devbox is offline.");
    expect(result.stdout).toContain("message_delivery herd event when it is delivered or fails");
  });

  it("reports a message to a running session as delivered without polling", async () => {
    const result = await sendWithDeliveries([], "sent");
    expect(result.status).toBe(0);
    expect(result.statusReads).toBe(0);
    expect(result.stdout).toContain("Message to session leader-b delivered");
  });
});
