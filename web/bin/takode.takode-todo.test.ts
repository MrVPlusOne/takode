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
    schemaVersion: 3,
    revision: 2,
    updatedAt: 200,
    nextItemId: 2,
    nextCategoryId: 1,
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
      expect(show.stdout).toContain("Last change: session, direct message");
      // Users never see td-N IDs, so show prints a ready-to-paste link with the plain-text title.
      expect(show.stdout).toContain("Link: [Reply to Alice](todo:td-1)");
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

  it("sets and clears due dates, sends --due on add, and marks overdue items in list output", async () => {
    const received: Array<[string, JsonObject]> = [];
    const server = createServer(async (req, res) => {
      if (req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && (req.url === "/api/todos/items/td-1/due" || req.url === "/api/todos/items")) {
        const body = await readJson(req);
        received.push([req.url, body]);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ state: snapshot(), item: { ...item(), ...(body.due ? { due: body.due } : {}) } }),
        );
      }
      if (req.url === "/api/todos/items") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            items: [
              { ...item(), titleMarkdown: "Old task", categoryName: "Inbox", due: "2020-01-02" },
              { ...item(), id: "td-2", titleMarkdown: "Later task", categoryName: "Inbox", due: "2999-01-02T09:30" },
            ],
          }),
        );
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      // A date and an optional time, as two arguments, become one local wall-clock value.
      const set = await runTakode(["todo", "due", "td-1", "2026-10-20", "14:30"], port);
      expect(set.status).toBe(0);
      expect(set.stdout).toContain("Set td-1 due 2026-10-20 14:30.");
      const clear = await runTakode(["todo", "due", "td-1", "clear", "--authorized-by", "42"], port);
      expect(clear.status).toBe(0);
      expect(clear.stdout).toContain("Cleared the due date of td-1.");
      const add = await runTakode(["todo", "add", "Book flights", "--due", "2026-10-21"], port);
      expect(add.status).toBe(0);
      expect(received).toEqual([
        ["/api/todos/items/td-1/due", { due: "2026-10-20T14:30" }],
        ["/api/todos/items/td-1/due", { due: null, authorizedBy: 42 }],
        ["/api/todos/items", { markdown: "Book flights", due: "2026-10-21" }],
      ]);
      // An impossible date fails before reaching the server.
      const bad = await runTakode(["todo", "due", "td-1", "2026-02-30"], port);
      expect(bad.status).toBe(1);
      expect(received).toHaveLength(3);

      const list = await runTakode(["todo", "list"], port);
      expect(list.stdout).toContain("Old task  (due 2020-01-02 OVERDUE)");
      expect(list.stdout).toContain("Later task  (due 2999-01-02 09:30)");
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
      if (req.method === "POST" && req.url === "/api/todos/items/td-1/status") {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error:
              "This to-do change needs the user's approval. Describe it to the user, linking the to-do, and rerun with --authorized-by <their reply's message index>, or cite a written standing approval that covers it with --standing-approval.",
          }),
        );
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runTakode(["todo", "status", "td-1", "done"], port);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("needs the user's approval");
      expect(result.stderr).toContain("--standing-approval");
    } finally {
      server.close();
    }
  });

  it("links quests through one link body and shows linked quest status in list and show", async () => {
    const received: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/takode/me") {
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && req.url === "/api/todos/items/td-1/links") {
        received.push(await readJson(req));
        return res.end(JSON.stringify({ state: snapshot(), item: { ...item(), questIds: ["q-7", "q-9"] } }));
      }
      if (req.url === "/api/todos/items") {
        return res.end(
          JSON.stringify({
            items: [
              {
                id: "td-1",
                titleMarkdown: "Ship export",
                categoryId: "cat-inbox",
                categoryName: "Inbox",
                status: "todo",
                createdAt: 100,
                updatedAt: 200,
                statusChangedAt: 200,
                linkedQuests: [
                  { questId: "q-7", status: "done" },
                  { questId: "q-9", status: "in_progress" },
                ],
              },
            ],
          }),
        );
      }
      if (req.url === "/api/todos/items/td-1") {
        return res.end(
          JSON.stringify({
            item: item(),
            category: snapshot().categories[0],
            linkedQuests: [{ questId: "q-7", status: "done", title: "Build the export" }],
          }),
        );
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      // Several quest IDs may be given as separate arguments or comma lists.
      const link = await runTakode(["todo", "link", "td-1", "q-7,q-9"], port);
      expect(link.status).toBe(0);
      expect(link.stdout).toContain("Linked quests: q-7, q-9");
      const unlink = await runTakode(["todo", "unlink", "td-1", "q-3", "q-4"], port);
      expect(unlink.status).toBe(0);
      expect(received).toEqual([{ addQuestIds: ["q-7", "q-9"] }, { removeQuestIds: ["q-3", "q-4"] }]);

      const list = await runTakode(["todo", "list"], port);
      expect(list.stdout).toContain("Ship export  ↳ q-7 done, q-9 in_progress");

      const show = await runTakode(["todo", "show", "td-1"], port);
      expect(show.stdout).toContain("Linked quests:\n  q-7 [done] Build the export");
    } finally {
      server.close();
    }
  });

  it("sends where an added to-do came from and the standing approval behind a change, and shows both", async () => {
    // Agents add to-dos on their own with --source, and cite a written standing approval for changes
    // that otherwise need the user's reply. show prints both so agents and the user can audit them.
    const received: Array<[string, JsonObject]> = [];
    const changed = {
      ...item(),
      status: "done",
      completedAt: 300,
      createdBy: {
        actor: { kind: "session", label: "Daily briefing" },
        authorization: { kind: "agent_direct" },
        at: 100,
        source: "Slack DM from Junhong",
      },
      lastModifiedBy: {
        actor: { kind: "session", label: "Daily briefing" },
        authorization: { kind: "standing_approval", standingApproval: "daily-briefing skill, To-do hygiene" },
        at: 300,
      },
    };
    const server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/takode/me") {
        return res.end(JSON.stringify({ sessionId: "worker-1", isOrchestrator: false }));
      }
      if (req.method === "POST" && (req.url === "/api/todos/items" || req.url === "/api/todos/items/td-1/status")) {
        received.push([req.url, await readJson(req)]);
        res.writeHead(req.url === "/api/todos/items" ? 201 : 200);
        return res.end(JSON.stringify({ state: snapshot(), item: changed }));
      }
      if (req.url === "/api/todos/items/td-1") {
        return res.end(JSON.stringify({ item: changed, category: snapshot().categories[0], linkedQuests: [] }));
      }
      res.writeHead(404).end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      const add = await runTakode(["todo", "add", "Review PR 98888", "--source", "Slack DM from Junhong"], port);
      expect(add.status).toBe(0);
      expect(add.stdout).toContain("Link: [Reply to Alice](todo:td-1)");
      const done = await runTakode(
        ["todo", "status", "td-1", "done", "--standing-approval", "daily-briefing skill, To-do hygiene"],
        port,
      );
      expect(done.status).toBe(0);
      expect(received).toEqual([
        ["/api/todos/items", { markdown: "Review PR 98888", source: "Slack DM from Junhong" }],
        ["/api/todos/items/td-1/status", { status: "done", standingApproval: "daily-briefing skill, To-do hygiene" }],
      ]);

      const show = await runTakode(["todo", "show", "td-1"], port);
      expect(show.stdout).toContain("Added by: session (Daily briefing), from Slack DM from Junhong");
      expect(show.stdout).toContain("Last change: session (Daily briefing), standing approval");
      expect(show.stdout).toContain("Standing approval: daily-briefing skill, To-do hygiene");

      // Proposals are retired.
      const propose = await runTakode(["todo", "propose", "add", "Review PR 98888"], port);
      expect(propose.status).toBe(1);
      expect(propose.stderr).toContain("Unknown todo command: propose");
    } finally {
      server.close();
    }
  });
});
