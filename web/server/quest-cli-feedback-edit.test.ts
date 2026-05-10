import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

async function runQuest(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
  stdinText?: string,
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
  if (stdinText !== undefined) child.stdin?.write(stdinText);
  child.stdin?.end();

  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
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

describe("quest feedback edit CLI", () => {
  it("documents the edit command and safer file-input example in help", async () => {
    const result = await runQuest(["--help"], { ...process.env });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("feedback edit <id> <index>");
    expect(result.stdout).toContain("quest feedback edit q-1 0 --text-file note.md --tldr-file note-tldr.md");
  });

  it("sends replacement feedback text and TLDR from safe file inputs via PATCH", async () => {
    // This guards the public CLI contract, while route tests cover metadata preservation inside the server.
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-edit-files-"));
    const textPath = join(tmp, "feedback.md");
    const tldrPath = join(tmp, "feedback-tldr.md");
    const text = [
      "Implement phase update: preserve phase metadata while editing the note.",
      'Copied command stays literal: quest feedback edit q-1 0 --text "$(cat note.md)"',
      'JSON-like text stays literal too: {"phase":"implement","ok":true}',
    ].join("\n");
    const tldr = "Edited the existing phase note instead of adding a duplicate.";
    writeFileSync(textPath, text, "utf-8");
    writeFileSync(tldrPath, tldr, "utf-8");

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "PATCH" && req.url === "/api/quests/q-1/feedback/2") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            questId: "q-1",
            title: "Quest",
            status: "in_progress",
            feedback: [{ author: "agent", text, tldr, ts: 10 }],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runQuest(
        ["feedback", "edit", "q-1", "2", "--text-file", textPath, "--tldr-file", tldrPath, "--json"],
        { ...process.env, COMPANION_PORT: String(port), HOME: tmp },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toEqual({ text, tldr });
      expect(JSON.parse(result.stdout)).toMatchObject({
        questId: "q-1",
        feedback: [expect.objectContaining({ text, tldr })],
      });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("edits feedback text from stdin and can send an empty TLDR file to clear metadata", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-edit-stdin-"));
    const tldrPath = join(tmp, "empty-tldr.md");
    writeFileSync(tldrPath, "", "utf-8");
    const text = ["Refreshed phase note from stdin.", "Keep `$(copied)` and {braces:true} as literal text."].join("\n");

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "PATCH" && req.url === "/api/quests/q-1/feedback/0") {
        seenBodies.push(await readJson(req));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ questId: "q-1", title: "Quest", status: "in_progress", feedback: [{ text, ts: 10 }] }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runQuest(
        ["feedback", "edit", "q-1", "0", "--text-file", "-", "--tldr-file", tldrPath, "--json"],
        { ...process.env, COMPANION_PORT: String(port), HOME: tmp },
        tmp,
        text,
      );

      expect(result.status).toBe(0);
      expect(seenBodies[0]).toEqual({ text, tldr: "" });
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects missing edit content and mixed inline/file inputs before sending PATCH", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-feedback-edit-invalid-"));
    const textPath = join(tmp, "feedback.md");
    writeFileSync(textPath, "literal payload", "utf-8");

    try {
      const missing = await runQuest(
        ["feedback", "edit", "q-1", "0"],
        { ...process.env, COMPANION_PORT: undefined, HOME: tmp },
        tmp,
      );
      const mixed = await runQuest(
        ["feedback", "edit", "q-1", "0", "--text", "inline", "--text-file", textPath],
        { ...process.env, COMPANION_PORT: undefined, HOME: tmp },
        tmp,
      );

      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain("Feedback edit requires --text/--text-file or --tldr/--tldr-file.");
      expect(mixed.status).not.toBe(0);
      expect(mixed.stderr).toContain("Use either --text or --text-file, not both");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
