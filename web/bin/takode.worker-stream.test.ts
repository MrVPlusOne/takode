import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
  stdin = "",
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(stdin);

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body));
  });
}

function createWorkerStreamServer(result: Record<string, unknown>, requests: string[]) {
  return createServer(async (req, res) => {
    const method = req.method || "";
    const url = req.url || "";
    requests.push(`${method} ${url}`);

    if (method === "GET" && url === "/api/takode/me") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      return;
    }

    if (method === "POST" && url === "/api/sessions/worker-1/worker-stream") {
      const body = await readBody(req);
      requests.push(`body ${body}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

describe("takode worker-stream", () => {
  // Authored reports must cross the real CLI boundary byte-for-byte, including shell-like text.
  it.each(["text", "file", "stdin"])("posts literal authored report input from %s", async (mode) => {
    const requests: string[] = [];
    const server = createWorkerStreamServer(
      {
        ok: true,
        recorded: true,
        queued: true,
        reused: false,
        questId: "q-1",
        feedbackIndex: 2,
        reportId: "report-id",
      },
      requests,
    );
    const directory = await mkdtemp(join(tmpdir(), "worker-report-cli-"));
    const text = "  Literal `code` and $(example)\nSecond line.\n";
    await writeFile(join(directory, "report.txt"), text);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const inputArgs =
        mode === "text" ? ["--text", text] : ["--text-file", mode === "stdin" ? "-" : join(directory, "report.txt")];
      const result = await runTakode(
        ["worker-stream", ...inputArgs, "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "worker-1",
          COMPANION_AUTH_TOKEN: "auth-worker",
        },
        mode === "stdin" ? text : "",
      );
      expect(result.status).toBe(0);
      expect(requests).toContain(`body ${JSON.stringify({ text })}`);
      expect(result.stdout).toContain("quest:q-1:feedback:2");
      expect(result.stdout).not.toContain(text);
    } finally {
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // Conflicting input forms must fail before any report POST can mutate the store.
  it("rejects ambiguous report inputs", async () => {
    const requests: string[] = [];
    const server = createWorkerStreamServer({}, requests);
    server.listen(0);
    await once(server, "listening");
    try {
      const result = await runTakode(
        [
          "worker-stream",
          "--text",
          "one",
          "--text-file",
          "-",
          "--port",
          String((server.address() as AddressInfo).port),
        ],
        {
          ...process.env,
          COMPANION_SESSION_ID: "worker-1",
          COMPANION_AUTH_TOKEN: "auth-worker",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("not both");
      expect(requests.some((request) => request.startsWith("POST"))).toBe(false);
    } finally {
      server.close();
    }
  });

  it("posts a self-session checkpoint and prints the streamed range", async () => {
    const requests: string[] = [];
    const server = createWorkerStreamServer(
      { ok: true, streamed: true, reason: "streamed", msgRange: { from: 10, to: 12 } },
      requests,
    );
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["worker-stream", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-1",
        COMPANION_AUTH_TOKEN: "auth-worker",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Worker stream checkpoint queued [10]-[12].");
      expect(result.stderr).toBe("");
      expect(requests).toContain("GET /api/takode/me");
      expect(requests).toContain("POST /api/sessions/worker-1/worker-stream");
      expect(requests).toContain("body {}");
    } finally {
      server.close();
    }
  });

  it("prints clean no-op messages for no-new-activity checkpoints", async () => {
    const requests: string[] = [];
    const server = createWorkerStreamServer({ ok: true, streamed: false, reason: "no_activity" }, requests);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["worker-stream", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-1",
        COMPANION_AUTH_TOKEN: "auth-worker",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("No worker stream checkpoint sent: no new activity to stream.");
      expect(result.stderr).toBe("");
    } finally {
      server.close();
    }
  });

  it("prints structured JSON when requested", async () => {
    const requests: string[] = [];
    const server = createWorkerStreamServer({ ok: true, streamed: false, reason: "not_generating" }, requests);
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["worker-stream", "--json", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "worker-1",
        COMPANION_AUTH_TOKEN: "auth-worker",
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, streamed: false, reason: "not_generating" });
      expect(result.stderr).toBe("");
    } finally {
      server.close();
    }
  });
});
