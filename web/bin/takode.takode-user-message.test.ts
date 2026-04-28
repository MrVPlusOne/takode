import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      resolve(body ? (JSON.parse(body) as JsonObject) : {});
    });
  });
}

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
  stdin?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin?.end(stdin ?? "");

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

describe("takode user-message", () => {
  it("requires a leader session and publishes Markdown from --text-file stdin", async () => {
    const userMessages: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      const method = req.method || "";
      const url = req.url || "";

      if (method === "GET" && url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-user-message", isOrchestrator: true }));
        return;
      }
      if (method === "POST" && url === "/api/sessions/leader-user-message/user-message") {
        userMessages.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId: "leader-user-message", messageId: "leader-user-1" }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(
        ["user-message", "--text-file", "-", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "leader-user-message",
          COMPANION_AUTH_TOKEN: "auth-user-message",
        },
        "Visible **Markdown** with $HOME and `code`\n",
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("User-visible message published");
      expect(userMessages).toEqual([{ content: "Visible **Markdown** with $HOME and `code`\n" }]);
    } finally {
      server.close();
    }
  });

  it("rejects inline positional message text", async () => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-inline", isOrchestrator: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(["user-message", "Do not inline this", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-inline",
        COMPANION_AUTH_TOKEN: "auth-inline",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Do not pass message text positionally");
    } finally {
      server.close();
    }
  });

  it("rejects positional text even when --text-file is present", async () => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-inline-with-file", isOrchestrator: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(
        ["user-message", "--text-file", "-", "Inline text", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "leader-inline-with-file",
          COMPANION_AUTH_TOKEN: "auth-inline-file",
        },
        "Visible Markdown",
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Do not pass message text positionally");
    } finally {
      server.close();
    }
  });

  it("is unavailable to normal worker sessions", async () => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-user-message", isOrchestrator: false }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runTakode(
        ["user-message", "--text-file", "-", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "worker-user-message",
          COMPANION_AUTH_TOKEN: "auth-worker",
        },
        "Workers should not publish this way.",
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("takode commands require an orchestrator session.");
    } finally {
      server.close();
    }
  });
});
