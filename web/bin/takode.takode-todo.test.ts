import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

interface JsonObject {
  [key: string]: unknown;
}

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  return raw ? (JSON.parse(raw) as JsonObject) : {};
}

async function runTakode(args: string[], port: number, stdin?: string) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    env: { ...process.env, COMPANION_SESSION_ID: "worker-1", COMPANION_AUTH_TOKEN: "auth-1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(stdin);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const [status] = await once(child, "close");
  return { status: status as number | null, stdout, stderr };
}

function snapshot() {
  return {
    schemaVersion: 2,
    revision: 2,
    updatedAt: 200,
    nextItemId: 2,
    nextCategoryId: 1,
    nextProposalId: 1,
    nextGrantId: 1,
    categories: [
      {
        id: "cat-inbox",
        name: "Inbox",
        createdAt: 1,
        updatedAt: 1,
        createdBy: { actor: { kind: "system" }, authorization: { kind: "bootstrap" }, at: 1 },
        lastModifiedBy: { actor: { kind: "system" }, authorization: { kind: "bootstrap" }, at: 1 },
      },
    ],
    items: [],
    proposals: [],
    grants: [],
  };
}

function item() {
  return {
    id: "td-1",
    markdown: "[Reply to Alice](https://example.slack.com/thread)\nPrivate full detail",
    rank: 1024,
    categoryId: "cat-inbox",
    status: "doing",
    createdAt: 100,
    updatedAt: 200,
    statusChangedAt: 200,
    createdBy: { actor: { kind: "session" }, authorization: { kind: "direct_message" }, at: 100 },
    lastModifiedBy: { actor: { kind: "session" }, authorization: { kind: "direct_message" }, at: 200 },
  };
}

describe("takode todo", () => {
  it("keeps default list output and JSON compact while targeted show reveals the raw body", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.url === "/api/todos/items") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            items: [
              {
                id: "td-1",
                titleMarkdown: "[Reply to Alice](https://example.slack.com/thread)",
                categoryId: "cat-inbox",
                categoryName: "Inbox",
                status: "doing",
                createdAt: 100,
                updatedAt: 200,
                statusChangedAt: 200,
              },
            ],
            revision: 2,
          }),
        );
      }
      if (req.url === "/api/todos/items/td-1") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ item: item(), category: snapshot().categories[0] }));
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const plain = await runTakode(["todo", "list"], port);
      expect(plain.status).toBe(0);
      expect(plain.stdout).toContain("td-1");
      expect(plain.stdout).toContain("Reply to Alice");
      expect(plain.stdout).not.toContain("Private full detail");

      const json = await runTakode(["todo", "list", "--json"], port);
      expect(json.status).toBe(0);
      const parsed = JSON.parse(json.stdout);
      expect(parsed[0]).toMatchObject({ id: "td-1", categoryName: "Inbox", status: "doing" });
      expect(parsed[0].markdown).toBeUndefined();
      expect(parsed[0].rank).toBeUndefined();
      expect(parsed[0].lastModifiedBy).toBeUndefined();

      const show = await runTakode(["todo", "show", "td-1"], port);
      expect(show.stdout).toContain("Markdown:\n[Reply to Alice]");
      expect(show.stdout).toContain("Private full detail");
      expect(show.stdout).toContain("Authorization: direct_message");
    } finally {
      server.close();
    }
  });

  it("reads one Markdown object from stdin without trimming and sends exact authorization provenance", async () => {
    let received: JsonObject | null = null;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && req.url === "/api/todos/items") {
        received = await readJson(req);
        const created = { ...item(), markdown: String(received.markdown), status: "todo" };
        res.writeHead(201, { "content-type": "application/json" });
        return res.end(JSON.stringify({ state: { ...snapshot(), items: [created] }, item: created }));
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const markdown = "[Reply to the Slack thread](https://example.slack.com/thread)\n\nKeep this spacing\n";
      const result = await runTakode(["todo", "add", "--markdown-file", "-", "--authorized-by", "42"], port, markdown);
      expect(result.status).toBe(0);
      expect(received).toMatchObject({ markdown, authorizedBy: 42 });
      expect(result.stdout).toContain("Added td-1 [todo]");
    } finally {
      server.close();
    }
  });

  it("keeps legacy title/details flags as compatibility inputs", async () => {
    let received: JsonObject | null = null;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && req.url === "/api/todos/items") {
        received = await readJson(req);
        const created = { ...item(), markdown: "Legacy title\nLegacy details", status: "todo" };
        res.writeHead(201, { "content-type": "application/json" });
        return res.end(JSON.stringify({ state: { ...snapshot(), items: [created] }, item: created }));
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runTakode(
        ["todo", "add", "--title", "Legacy title", "--details", "Legacy details", "--authorized-by", "42"],
        port,
      );
      expect(result.status).toBe(0);
      expect(received).toMatchObject({ titleMarkdown: "Legacy title", detailsMarkdown: "Legacy details" });
    } finally {
      server.close();
    }
  });

  it("sends ordering references through the compatible move command", async () => {
    let received: JsonObject | null = null;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && req.url === "/api/todos/items/td-1/move") {
        received = await readJson(req);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ state: snapshot(), item: item() }));
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runTakode(["todo", "move", "td-1", "--before", "td-2", "--authorized-by", "42"], port);
      expect(result.status).toBe(0);
      expect(received).toMatchObject({ beforeItemId: "td-2", authorizedBy: 42 });
    } finally {
      server.close();
    }
  });

  it("surfaces fail-closed authorization errors instead of silently mutating", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && req.url === "/api/todos/items") {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error:
              "This to-do mutation is not authorized. Use --authorized-by <human-message-index>, run under a matching workflow grant, or create a proposal instead.",
          }),
        );
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runTakode(["todo", "add", "Unapproved"], port);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not authorized");
      expect(result.stderr).toContain("create a proposal instead");
    } finally {
      server.close();
    }
  });
});
