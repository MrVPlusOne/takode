import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCliWriteServer } from "./test-fixtures/cli-write-server-harness.js";

type JsonObject = Record<string, unknown>;

function seedQuest(home: string, quest: JsonObject): void {
  const questDir = join(home, ".companion", "questmaster");
  mkdirSync(questDir, { recursive: true });
  writeFileSync(join(questDir, `${quest.id}.json`), JSON.stringify(quest, null, 2), "utf-8");
}

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body ? (JSON.parse(body) as JsonObject) : {}));
  });
}

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR:
        env.BUN_INSTALL_CACHE_DIR ||
        process.env.BUN_INSTALL_CACHE_DIR ||
        join(process.env.HOME || "", ".bun/install/cache"),
    },
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

function baseEnv(home: string, port?: number): Record<string, string | undefined> {
  return {
    ...process.env,
    COMPANION_PORT: port === undefined ? undefined : String(port),
    COMPANION_SESSION_ID: port === undefined ? undefined : "session-test",
    COMPANION_AUTH_TOKEN: port === undefined ? undefined : "token-test",
    HOME: home,
  };
}

describe("quest CLI feedback inspection", () => {
  it("prints unaddressed human feedback in quest show and warns about it", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-show-"));
    seedQuest(tmp, {
      id: "q-1-v2",
      questId: "q-1",
      version: 2,
      title: "Feedback quest",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Inspect indexed feedback.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [
        { author: "human", text: "Please fix the handoff.", ts: Date.now() - 20_000 },
        { author: "agent", text: "Summary: initial implementation.", ts: Date.now() - 10_000 },
      ],
    });

    try {
      const result = await runQuest(["show", "q-1"], baseEnv(tmp), tmp);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("#0 [human");
      expect(result.stdout).not.toContain("#1 [agent");
      expect(result.stderr).toContain("Warning: unaddressed human feedback on q-1: #0");
      expect(result.stderr).toContain("quest feedback list q-1 --unaddressed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("lists, shows, and returns latest feedback entries with stable JSON indices", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-readonly-"));
    seedQuest(tmp, {
      id: "q-2-v2",
      questId: "q-2",
      version: 2,
      title: "Read feedback",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Read feedback without jq.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [
        { author: "human", text: "First human note", ts: 10, addressed: true },
        { author: "agent", text: "Summary: handled first note", ts: 20, machine: "devbox" },
        { author: "human", text: "Second human note", ts: 30 },
      ],
    });

    try {
      const list = await runQuest(
        ["feedback", "list", "q-2", "--author", "human", "--unaddressed", "--json"],
        baseEnv(tmp),
        tmp,
      );
      const latest = await runQuest(["feedback", "latest", "q-2", "--author", "human", "--json"], baseEnv(tmp), tmp);
      const show = await runQuest(["feedback", "show", "q-2", "1", "--json"], baseEnv(tmp), tmp);

      expect(list.status).toBe(0);
      expect(JSON.parse(list.stdout)).toMatchObject([{ index: 2, author: "human", text: "Second human note" }]);
      expect(JSON.parse(latest.stdout)).toMatchObject({ index: 2, author: "human", text: "Second human note" });
      expect(JSON.parse(show.stdout)).toMatchObject({ index: 1, author: "agent", text: "Summary: handled first note" });

      const textShow = await runQuest(["feedback", "show", "q-2", "1"], baseEnv(tmp), tmp);
      expect(textShow.stdout).toContain("#1 [agent, summary,");
      // The machine a note was written on appears next to its author.
      expect(textShow.stdout).toContain(", on devbox,");
      expect(textShow.stdout).not.toContain("[agent, agent,");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("hides tombstones while preserving later stable feedback indices", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-tombstone-"));
    seedQuest(tmp, {
      id: "q-8-v2",
      questId: "q-8",
      version: 2,
      title: "Deleted feedback slot",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Preserve exact feedback indices.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [
        { author: "human", text: "deleted content", ts: 10, deletedAt: 11 },
        { author: "agent", text: "Live agent note", ts: 20 },
        { author: "human", text: "Live human note", ts: 30, addressed: false },
      ],
    });

    try {
      const list = await runQuest(["feedback", "list", "q-8", "--json"], baseEnv(tmp), tmp);
      const showQuest = await runQuest(["show", "q-8", "--full"], baseEnv(tmp), tmp);
      const deleted = await runQuest(["feedback", "show", "q-8", "0"], baseEnv(tmp), tmp);
      const live = await runQuest(["feedback", "show", "q-8", "1", "--json"], baseEnv(tmp), tmp);
      const status = await runQuest(["status", "q-8", "--json"], baseEnv(tmp), tmp);

      expect(list.status).toBe(0);
      expect(JSON.parse(list.stdout).map((entry: { index: number }) => entry.index)).toEqual([1, 2]);
      expect(showQuest.stdout).not.toContain("deleted content");
      expect(showQuest.stdout).not.toContain("#0 [human");
      expect(showQuest.stderr).not.toContain("unaddressed human feedback on q-8: #0");
      expect(deleted.status).toBe(1);
      expect(deleted.stderr).toContain("Feedback index 0 was deleted");
      expect(JSON.parse(live.stdout)).toMatchObject({ index: 1, text: "Live agent note" });
      expect(JSON.parse(status.stdout)).toMatchObject({
        humanFeedbackCount: 1,
        unaddressedHumanFeedbackIndices: [2],
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prints compact status JSON without mixing warnings into stdout", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-status-json-"));
    seedQuest(tmp, {
      id: "q-3-v3",
      questId: "q-3",
      version: 3,
      title: "Status quest",
      createdAt: Date.now() - 60_000,
      status: "done",
      description: "Compact status.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      verificationItems: [{ text: "Visual check", checked: false }],
      verificationInboxUnread: true,
      commitShas: ["abc1234"],
      feedback: [
        { author: "human", text: "Please adjust copy", ts: 10 },
        { author: "agent", text: "Summary: shipped status command", ts: 20 },
      ],
    });

    try {
      const result = await runQuest(["status", "q-3", "--json"], baseEnv(tmp), tmp);
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(parsed).toMatchObject({
        questId: "q-3",
        status: "done",
        inbox: "unread",
        commitCount: 1,
        humanFeedbackCount: 1,
        unaddressedHumanFeedbackIndices: [0],
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves legacy feedback add and supports explicit add alias with advisory summary warnings", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-add-alias-"));
    const quest = {
      id: "q-4-v2",
      questId: "q-4",
      version: 2,
      title: "Add feedback",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Add feedback.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [{ author: "agent", text: "Summary: old", ts: 10, authorSessionId: "session-test" }],
    };
    seedQuest(tmp, quest);
    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      // The server is authoritative for reads, so it serves the quest the CLI inspects for an existing summary.
      if (req.method === "GET" && req.url === "/api/quests/q-4") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(quest));
        return;
      }
      if (req.method === "POST" && req.url === "/api/quests/q-4/feedback") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...quest, feedback: [{ author: "agent", text: "Summary: refreshed", ts: 30 }] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const legacy = await runQuest(["feedback", "q-4", "--text", "Summary: refreshed"], baseEnv(tmp, port), tmp);
      const explicit = await runQuest(
        ["feedback", "add", "q-4", "--text", "Summary: refreshed"],
        baseEnv(tmp, port),
        tmp,
      );

      expect(legacy.status).toBe(0);
      expect(explicit.status).toBe(0);
      expect(seenBodies).toHaveLength(2);
      expect(legacy.stderr).toContain("refreshed existing summary feedback #0");
      expect(explicit.stderr).toContain("refreshed existing summary feedback #0");
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps completion JSON parseable while emitting advisory hygiene warnings to stderr", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-hygiene-"));
    seedQuest(tmp, {
      id: "q-5-v2",
      questId: "q-5",
      version: 2,
      title: "Complete warnings",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Implemented in abc1234.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [
        { author: "agent", text: "Summary: old work", ts: 10, authorSessionId: "session-test" },
        { author: "human", text: "Please update tests", ts: 20 },
      ],
    });

    // Unauthenticated completion goes through the server like every quest write.
    const server = await startCliWriteServer(tmp);

    try {
      const result = await runQuest(
        ["complete", "q-5", "--items", "Run typecheck,Human visual check", "--json"],
        { ...baseEnv(tmp), COMPANION_PORT: String(server.port) },
        tmp,
      );
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(parsed).toMatchObject({ questId: "q-5", status: "done" });
      expect(result.stderr).toContain("unaddressed human feedback remains at #1");
      expect(result.stderr).toContain("latest human feedback is newer than the latest agent summary");
      expect(result.stderr).toContain("commit-like SHA text exists");
      expect(result.stderr).toContain("user review check(s) 0 look self-verifiable");
      expect(result.stderr).toContain("reserve user review checks for things the user needs to inspect");
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not warn for manual-test wording or existing structured commit metadata", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-hygiene-existing-commit-"));
    seedQuest(tmp, {
      id: "q-6-v2",
      questId: "q-6",
      version: 2,
      title: "Complete existing metadata",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Follow-up mentions abc1234 from the previous handoff.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      commitShas: ["abc1234"],
      feedback: [{ author: "agent", text: "Summary: follow-up ready", ts: 20, authorSessionId: "session-test" }],
    });

    // Unauthenticated completion goes through the server like every quest write.
    const server = await startCliWriteServer(tmp);

    try {
      const result = await runQuest(
        ["complete", "q-6", "--items", "Manually test the mobile layout,Run typecheck", "--json"],
        { ...baseEnv(tmp), COMPANION_PORT: String(server.port) },
        tmp,
      );
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(parsed).toMatchObject({ questId: "q-6", status: "done" });
      expect(result.stderr).not.toContain("commit-like SHA text exists");
      expect(result.stderr).toContain("user review check(s) 1 look self-verifiable");
      expect(result.stderr).not.toContain("user review check(s) 0 look self-verifiable");
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("warns when user review checks are implementation logs instead of human acceptance items", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-implementation-log-items-"));
    seedQuest(tmp, {
      id: "q-7-v2",
      questId: "q-7",
      version: 2,
      title: "Implementation log checklist",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Implementation details belong in Summary feedback.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
      feedback: [{ author: "agent", text: "Summary: implementation details recorded", ts: 20 }],
    });

    // Unauthenticated completion goes through the server like every quest write.
    const server = await startCliWriteServer(tmp);

    try {
      const result = await runQuest(
        [
          "complete",
          "q-7",
          "--items",
          "Synced commit 72e1a401159f3c71105e8b80536a5fb77e44a5c8 was pushed to origin/jiayi,User can confirm the workflow copy reads clearly",
          "--json",
        ],
        { ...baseEnv(tmp), COMPANION_PORT: String(server.port) },
        tmp,
      );
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(parsed).toMatchObject({ questId: "q-7", status: "done" });
      expect(result.stderr).toContain("user review check(s) 0 look like implementation details or port metadata");
      expect(result.stderr).toContain("use structured --commit/--commits metadata for synced SHAs");
      expect(result.stderr).not.toContain("user review check(s) 1 look like implementation details");
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads single quests and session labels from the server, and the local store when it is down", async () => {
    // The server answers from its in-memory store in a few ms, while a local read
    // parses the whole store file. Session labels are fetched only for sessions
    // the quest mentions, never the full session list.
    const tmp = mkdtempSync(join(tmpdir(), "quest-server-reads-"));
    const quest = {
      id: "q-6-v1",
      questId: "q-6",
      version: 1,
      title: "Local title",
      createdAt: Date.now() - 60_000,
      status: "in_progress",
      description: "Read path.",
      sessionId: "session-test",
      claimedAt: Date.now() - 30_000,
    };
    seedQuest(tmp, quest);
    const requests: string[] = [];
    let labelIds: unknown;
    const server = createServer(async (req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.method === "GET" && req.url === "/api/quests/q-6") {
        res.end(JSON.stringify({ ...quest, title: "Server title" }));
      } else if (req.method === "POST" && req.url === "/api/sessions/_labels") {
        labelIds = (await readJson(req)).sessionIds;
        res.end(JSON.stringify([{ sessionId: "session-test", sessionNum: 9, name: "Labelled Worker" }]));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const viaServer = await runQuest(["show", "q-6"], baseEnv(tmp, port), tmp);
      expect(viaServer.status).toBe(0);
      expect(viaServer.stdout).toContain("Server title");
      expect(viaServer.stdout).toContain("Labelled Worker");
      expect(labelIds).toEqual(["session-test"]);
      expect(requests).not.toContain("GET /api/sessions");

      const local = await runQuest(["show", "q-6"], baseEnv(tmp), tmp);
      expect(local.status).toBe(0);
      expect(local.stdout).toContain("Local title");
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
