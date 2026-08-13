import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  return raw ? (JSON.parse(raw) as JsonObject) : {};
}

async function runTakode(args: string[], port: number, stdin?: string) {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args, "--port", String(port)], {
    env: {
      ...process.env,
      COMPANION_SESSION_ID: "worker-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    },
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
    schemaVersion: 1,
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
    titleMarkdown: "[Reply to Alice](https://example.slack.com/thread)",
    detailsMarkdown: "Private full detail",
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
  it("keeps default list output compact and compact JSON free of details/provenance", async () => {
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
                titleMarkdown: item().titleMarkdown,
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
      expect(plain.stdout).not.toContain("lastModifiedBy");

      const json = await runTakode(["todo", "list", "--json"], port);
      expect(json.status).toBe(0);
      const parsed = JSON.parse(json.stdout);
      expect(parsed[0]).toMatchObject({ id: "td-1", categoryName: "Inbox", status: "doing" });
      expect(parsed[0].detailsMarkdown).toBeUndefined();
      expect(parsed[0].lastModifiedBy).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("reads Markdown from stdin and sends exact direct-message provenance", async () => {
    let received: JsonObject | null = null;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "GET" && req.url === "/api/todos/categories") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            categories: snapshot().categories.map((category) => ({ ...category, activeItemCount: 0 })),
          }),
        );
      }
      if (req.method === "POST" && req.url === "/api/todos/items") {
        received = await readJson(req);
        const created = { ...item(), titleMarkdown: String(received.titleMarkdown), status: "todo" };
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
        ["todo", "add", "--title-file", "-", "--category", "Inbox", "--authorized-by", "42"],
        port,
        "[Reply to the Slack thread](https://example.slack.com/thread)\n",
      );
      expect(result.status).toBe(0);
      expect(received).toMatchObject({
        titleMarkdown: "[Reply to the Slack thread](https://example.slack.com/thread)",
        categoryId: "cat-inbox",
        authorizedBy: 42,
      });
      expect(result.stdout).toContain("Added td-1 [todo]");
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
      if (req.method === "GET" && req.url === "/api/todos/categories") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            categories: snapshot().categories.map((category) => ({ ...category, activeItemCount: 0 })),
          }),
        );
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
