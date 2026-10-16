import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// Runs the real takode CLI against a mock server to check the request that
// `board rm --leader` sends and how it reports the removal.

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => resolve(body));
  });
}

async function runTakode(args: string[], port: number) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./takode.ts", import.meta.url)), ...args], {
    env: {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
      COMPANION_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const [status] = await once(child, "close");
  return { status: status as number | null, stdout, stderr };
}

describe("takode board rm --leader", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;
  const requests: Array<{ url?: string; body: string }> = [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/takode/me") {
        res.end(JSON.stringify({ sessionId: "leader-1", isOrchestrator: true }));
        return;
      }
      requests.push({ url: req.url, body: await readBody(req) });
      res.end(
        JSON.stringify({
          leaderSessionId: "stale-leader",
          leaderSessionNum: 20,
          removed: { questId: "q-7", status: "USER_CHECKPOINTING" },
        }),
      );
    });
    server.listen(0);
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());
  beforeEach(() => requests.splice(0));

  it("asks the server to remove the stopped leader's row with the reason", async () => {
    const result = await runTakode(
      ["board", "rm", "q-7", "--leader", "#20", "--reason", "Obsolete checkpoint", "--port", String(port)],
      port,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(requests).toEqual([
      { url: "/api/sessions/20/board/q-7/remove-stale", body: JSON.stringify({ reason: "Obsolete checkpoint" }) },
    ]);
    expect(result.stdout).toContain("Removed q-7 (was USER_CHECKPOINTING) from #20's board");
  });

  it("requires a reason before calling the server", async () => {
    const result = await runTakode(["board", "rm", "q-7", "--leader", "20", "--port", String(port)], port);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--reason");
    expect(requests).toEqual([]);
  });
});
