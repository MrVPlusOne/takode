import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSessionAuthDir, getSessionAuthPath } from "../shared/session-auth.js";
import { startCliWriteServer } from "./test-fixtures/cli-write-server-harness.js";

type JsonObject = Record<string, unknown>;

/** Compute centralized auth path — must match getSessionAuthPath() in cli-launcher.ts.
 * Uses explicit home parameter since tests override HOME for the child process. */
function centralAuthPath(cwd: string, home?: string, serverId = "test-server-id"): string {
  return getSessionAuthPath(cwd, serverId, home);
}

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

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
  stdinText?: string,
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const childEnv = {
    ...env,
    // Keep Bun's package cache on the real home directory even when tests
    // override HOME to isolate the quest store under a temp directory.
    BUN_INSTALL_CACHE_DIR:
      env.BUN_INSTALL_CACHE_DIR ||
      process.env.BUN_INSTALL_CACHE_DIR ||
      join(process.env.HOME || "", ".bun/install/cache"),
  };
  const child = spawn(process.execPath, [questPath, ...args], {
    env: childEnv,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  if (stdinText !== undefined) {
    child.stdin?.write(stdinText);
  }
  child.stdin?.end();

  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

describe("quest CLI safer rich-text inputs", () => {
  it("reads feedback text from --text-file and preserves shell-like payloads literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-text-file-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const textPath = join(tmp, "feedback.txt");
    const payload = [
      "Refreshed summary: literal backticks `!#tag` should survive.",
      'Copied log: excluding: "artifact $(rm -rf /tmp/nope)"',
      'Quotes and braces stay literal: {"mode":"safe","ok":true}',
    ].join("\n");
    writeFileSync(textPath, payload, "utf-8");

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/feedback") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", feedback: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        ["feedback", "q-1", "--text-file", textPath, "--json"],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        text: payload,
        author: "agent",
        sessionId: "session-file",
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes phase documentation flags through the feedback endpoint", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-phase-flags-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/feedback") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", feedback: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        [
          "feedback",
          "add",
          "q-1",
          "--text",
          "Summary: implement docs",
          "--tldr",
          "Docs summary",
          "--phase",
          "implement",
          "--phase-position",
          "3",
          "--phase-occurrence",
          "1",
          "--journey-run",
          "run-1",
          "--kind",
          "phase-summary",
          "--json",
        ],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        text: "Summary: implement docs",
        tldr: "Docs summary",
        author: "agent",
        sessionId: "session-file",
        phase: "implement",
        phasePosition: "3",
        phaseOccurrence: "1",
        journeyRunId: "run-1",
        kind: "phase-summary",
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads feedback text from stdin via --text-file -", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-stdin-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const payload = [
      "Addressed: copied shell transcript stays literal.",
      "Treat `foo` and $(bar) as text, not shell.",
      'Final line keeps commas, quotes "yes", and braces {ok:true}.',
    ].join("\n");

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/feedback") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", feedback: [] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        ["feedback", "q-1", "--text-file", "-", "--json"],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
        payload,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        text: payload,
        author: "agent",
        sessionId: "session-file",
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects mixing --text with --text-file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-mixed-input-"));
    const textPath = join(tmp, "feedback.txt");
    writeFileSync(textPath, "literal payload", "utf-8");

    try {
      const result = await runQuest(
        ["feedback", "q-1", "--text", "inline", "--text-file", textPath],
        {
          ...process.env,
          COMPANION_PORT: undefined,
          COMPANION_SESSION_ID: "session-inline",
          COMPANION_AUTH_TOKEN: "token-inline",
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Use either --text or --text-file, not both");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads create title/description from --title-file and --desc-file literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-create-rich-text-files-"));
    const server = await startCliWriteServer(tmp);
    const titlePath = join(tmp, "title.txt");
    const descPath = join(tmp, "description.md");
    const title = 'Quest title with `!#tag`, "$(echo nope)", and {braces}';
    const description = [
      "Description should preserve copied shell-like content literally.",
      'Keep `quest create` and "$(echo nope)" as plain text.',
      'Quotes, commas, and braces stay intact: {"safe":true,"ok":"yes"}',
    ].join("\n");
    writeFileSync(titlePath, title, "utf-8");
    writeFileSync(descPath, description, "utf-8");

    try {
      const result = await runQuest(
        ["create", "--title-file", titlePath, "--desc-file", descPath, "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        title,
        description,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads create description from stdin via --desc-file -", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-create-rich-text-stdin-"));
    const server = await startCliWriteServer(tmp);
    const description = [
      "stdin description keeps copied snippets literal.",
      'Treat `foo`, "$(bar)", and {json:true} as plain text.',
    ].join("\n");

    try {
      const result = await runQuest(
        ["create", "Rich text quest", "--desc-file", "-", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
        description,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        title: "Rich text quest",
        description,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads edit title/description from file inputs literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-edit-rich-text-files-"));
    const server = await startCliWriteServer(tmp);
    const titlePath = join(tmp, "title.txt");
    const descPath = join(tmp, "description.md");
    const title = 'Edited `title` with "$(echo nope)" and {braces}';
    const description = [
      "Edited description keeps literal backticks and command text.",
      'Keep `quest edit` and "$(echo nope)" as text, not shell.',
    ].join("\n");
    writeFileSync(titlePath, title, "utf-8");
    writeFileSync(descPath, description, "utf-8");

    try {
      const created = await runQuest(
        ["create", "Original title", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const result = await runQuest(
        ["edit", quest.questId, "--title-file", titlePath, "--desc-file", descPath, "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: quest.questId,
        title,
        description,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads transition description from --desc-file literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-transition-rich-text-file-"));
    const server = await startCliWriteServer(tmp);
    const descPath = join(tmp, "transition-description.md");
    const description = [
      "Transition description update should keep copied snippets literal.",
      'Keep `quest transition` and "$(echo nope)" as text.',
    ].join("\n");
    writeFileSync(descPath, description, "utf-8");

    try {
      const created = await runQuest(
        ["create", "Transition me", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const result = await runQuest(
        ["transition", quest.questId, "--status", "refined", "--desc-file", descPath, "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: quest.questId,
        status: "refined",
        description,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects mixing create/edit inline and file rich-text flags", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-create-edit-mixed-rich-text-"));
    const server = await startCliWriteServer(tmp);
    const descPath = join(tmp, "description.md");
    const titlePath = join(tmp, "title.txt");
    writeFileSync(descPath, "literal description", "utf-8");
    writeFileSync(titlePath, "literal title", "utf-8");

    try {
      const createResult = await runQuest(
        ["create", "Quest title", "--desc", "inline", "--desc-file", descPath],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(createResult.status).not.toBe(0);
      expect(createResult.stderr).toContain("Use either --desc or --desc-file, not both");

      const created = await runQuest(
        ["create", "Original title", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const editResult = await runQuest(
        ["edit", quest.questId, "--title", "inline", "--title-file", titlePath],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(editResult.status).not.toBe(0);
      expect(editResult.stderr).toContain("Use either --title or --title-file, not both");
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects reading multiple rich-text options from stdin in one command", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-multiple-stdin-rich-text-"));

    try {
      const result = await runQuest(
        ["create", "--title-file", "-", "--desc-file", "-", "--json"],
        {
          ...process.env,
          COMPANION_PORT: undefined,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
        "shared stdin payload",
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Only one option can read from stdin per command");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads done notes from --notes-file literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-done-notes-file-"));
    const server = await startCliWriteServer(tmp);
    const notesPath = join(tmp, "closeout.txt");
    const notes = [
      "Closed after keeping copied shell-like text literal.",
      'Keep `quest done`, "$(echo nope)", and {json:true} as text.',
    ].join("\n");
    writeFileSync(notesPath, notes, "utf-8");

    try {
      const created = await runQuest(
        ["create", "Quest to close", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const refined = await runQuest(
        ["transition", quest.questId, "--status", "refined", "--desc", "Ready for closeout", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      expect(refined.status).toBe(0);

      const result = await runQuest(
        ["done", quest.questId, "--notes-file", notesPath, "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: quest.questId,
        status: "done",
        notes,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads final debrief and debrief TLDR from files", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-done-debrief-file-"));
    const server = await startCliWriteServer(tmp);
    const debriefPath = join(tmp, "debrief.md");
    const debriefTldrPath = join(tmp, "debrief-tldr.md");
    const debrief = [
      "Shipped the requested workflow update.",
      "Verified CLI output and preserved copied `$(shell)` text literally.",
    ].join("\n");
    const debriefTldr = "Workflow update shipped with CLI verification.";
    writeFileSync(debriefPath, debrief, "utf-8");
    writeFileSync(debriefTldrPath, debriefTldr, "utf-8");

    try {
      const created = await runQuest(
        ["create", "Quest to debrief", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const refined = await runQuest(
        ["transition", quest.questId, "--status", "refined", "--desc", "Ready for closeout", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      expect(refined.status).toBe(0);

      const result = await runQuest(
        ["done", quest.questId, "--debrief-file", debriefPath, "--debrief-tldr-file", debriefTldrPath, "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: quest.questId,
        status: "done",
        debrief,
        debriefTldr,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads cancel notes from stdin via --notes-file - literally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-cancel-notes-stdin-"));
    const server = await startCliWriteServer(tmp);
    const notes = [
      "Superseded after preserving copied shell-like text literally.",
      'Keep `quest cancel`, "$(echo nope)", and {json:true} as text.',
    ].join("\n");

    try {
      const created = await runQuest(
        ["create", "Quest to cancel", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const result = await runQuest(
        ["cancel", quest.questId, "--notes-file", "-", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
        notes,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: quest.questId,
        status: "done",
        cancelled: true,
        notes,
      });
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects mixing inline notes and --notes-file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-notes-mixed-input-"));
    const server = await startCliWriteServer(tmp);
    const notesPath = join(tmp, "closeout.txt");
    writeFileSync(notesPath, "literal notes", "utf-8");

    try {
      const created = await runQuest(
        ["create", "Quest title", "--json"],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      const quest = JSON.parse(created.stdout) as { questId: string };

      const doneResult = await runQuest(
        ["done", quest.questId, "--notes", "inline", "--notes-file", notesPath],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      expect(doneResult.status).not.toBe(0);
      expect(doneResult.stderr).toContain("Use either --notes or --notes-file, not both");

      const cancelResult = await runQuest(
        ["cancel", quest.questId, "--notes", "inline", "--notes-file", notesPath],
        {
          ...process.env,
          COMPANION_PORT: String(server.port),
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );
      expect(cancelResult.status).not.toBe(0);
      expect(cancelResult.stderr).toContain("Use either --notes or --notes-file, not both");
    } finally {
      await server.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads User review checks from --items-file line input with shell-fragile characters", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-items-file-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const itemsPath = join(tmp, "items.txt");
    const items = [
      "Confirm copied log line `excluding:` stays literal and readable",
      'Confirm `!#tag`, $(dont-run), and "quotes" survive untouched',
      "Confirm commas, braces {ok:true}, and copied snippets remain one checklist item",
    ];
    writeFileSync(itemsPath, `${items.join("\n")}\n`, "utf-8");

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/complete") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "done" }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/quests/_notify") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        ["complete", "q-1", "--items-file", itemsPath, "--json"],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        verificationItems: items.map((text) => ({ text, checked: false })),
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads User review checks from stdin via --items-file - using JSON array input", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-items-stdin-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const items = [
      "Confirm JSON array input keeps `backticks` literal",
      'Confirm "$(echo nope)" and braces {"safe":true} stay in one item',
    ];
    const stdinJson = JSON.stringify(items);

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/complete") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "done" }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/quests/_notify") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        ["complete", "q-1", "--items-file", "-", "--json"],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
        stdinJson,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        verificationItems: items.map((text) => ({ text, checked: false })),
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads User review checks from --items-file JSON object arrays", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-items-object-json-"));
    const authDir = getSessionAuthDir(tmp);
    mkdirSync(authDir, { recursive: true });
    const authPath = centralAuthPath(tmp, tmp);
    const itemsPath = join(tmp, "items.json");
    writeFileSync(
      itemsPath,
      JSON.stringify([
        { text: "Confirm object-array input keeps `backticks` literal" },
        { text: ' Confirm "$(echo nope)" and braces {"safe":true} stay in one item ' },
      ]),
      "utf-8",
    );

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/quests/q-1/complete") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ questId: "q-1", title: "Quest", status: "done" }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/quests/_notify") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    writeFileSync(
      authPath,
      JSON.stringify({ sessionId: "session-file", authToken: "file-token", port, serverId: "test-server-id" }),
      "utf-8",
    );

    try {
      const result = await runQuest(
        ["complete", "q-1", "--items-file", itemsPath, "--json"],
        {
          ...process.env,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          COMPANION_PORT: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toMatchObject({
        verificationItems: [
          { text: "Confirm object-array input keeps `backticks` literal", checked: false },
          { text: 'Confirm "$(echo nope)" and braces {"safe":true} stay in one item', checked: false },
        ],
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects invalid JSON object items in --items-file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-invalid-object-json-"));
    const itemsPath = join(tmp, "items.json");
    writeFileSync(itemsPath, JSON.stringify([{ label: "missing text" }, { text: "ok" }]), "utf-8");

    try {
      const result = await runQuest(
        ["complete", "q-1", "--items-file", itemsPath],
        {
          ...process.env,
          COMPANION_PORT: undefined,
          COMPANION_SESSION_ID: "session-inline",
          COMPANION_AUTH_TOKEN: "token-inline",
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "--items-file item 1 must be a non-empty string or object with a non-empty text field",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects mixing --items with --items-file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-complete-mixed-input-"));
    const itemsPath = join(tmp, "items.txt");
    writeFileSync(itemsPath, "literal item", "utf-8");

    try {
      const result = await runQuest(
        ["complete", "q-1", "--items", "inline item", "--items-file", itemsPath],
        {
          ...process.env,
          COMPANION_PORT: undefined,
          COMPANION_SESSION_ID: "session-inline",
          COMPANION_AUTH_TOKEN: "token-inline",
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Use either --items or --items-file, not both");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
