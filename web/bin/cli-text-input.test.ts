import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Entry = "companion" | "takode";
type Request = { path: string; method: string; body: Record<string, unknown> };
let root: string;
let server: Server;
let port: number;
let requests: Request[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cli-text-input-"));
  requests = [];
  // Every real CLI subprocess targets this ephemeral fake server. No application
  // store or live session is touched, including for negative/mutation cases.
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/takode/me") {
      res.end(JSON.stringify({ isOrchestrator: true }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ path: req.url!, method: req.method!, body });
    res.end(
      JSON.stringify({
        ok: true,
        board: [],
        approvalId: "a".repeat(32),
        refCount: 1,
        timer: { id: "t1", title: body.title, type: "delay", nextFireAt: 1 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function run(entry: Entry, args: string[], stdin = "") {
  const script = fileURLToPath(new URL(entry === "takode" ? "./takode.ts" : "./cli.ts", import.meta.url));
  const child = spawn(process.execPath, [script, ...args, "--port", String(port)], {
    cwd: root,
    env: { ...process.env, COMPANION_SESSION_ID: "cli-input-fixture", COMPANION_AUTH_TOKEN: "fixture-token" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  child.stdin.end(stdin);
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

const cases: Array<{
  entry: Entry;
  args: string[];
  inline: string;
  file: string;
  path: string;
  field: string;
  trim?: boolean;
}> = [
  {
    entry: "companion",
    args: ["skills", "create", "--name", "fixture"],
    inline: "--content",
    file: "--content-file",
    path: "/api/skills",
    field: "content",
  },
  {
    entry: "companion",
    args: ["skills", "update", "fixture"],
    inline: "--content",
    file: "--content-file",
    path: "/api/skills/fixture",
    field: "content",
  },
  {
    entry: "companion",
    args: ["cron", "create", "--name", "fixture", "--schedule", "0 * * * *"],
    inline: "--prompt",
    file: "--prompt-file",
    path: "/api/cron/jobs",
    field: "prompt",
  },
  {
    entry: "companion",
    args: ["cron", "update", "fixture"],
    inline: "--prompt",
    file: "--prompt-file",
    path: "/api/cron/jobs/fixture",
    field: "prompt",
  },
  {
    entry: "takode",
    args: ["board", "propose", "q-1", "--phases", "alignment,work,memory", "--json"],
    inline: "--summary",
    file: "--summary-file",
    path: "/api/sessions/cli-input-fixture/board",
    field: "presentation",
    trim: true,
  },
  {
    entry: "takode",
    args: ["board", "note", "q-1", "2", "--json"],
    inline: "--text",
    file: "--text-file",
    path: "/api/sessions/cli-input-fixture/board",
    field: "phaseNoteEdits",
  },
  {
    entry: "takode",
    args: ["timer", "create", "Fixture", "--in", "1h", "--thread", "main"],
    inline: "--desc",
    file: "--desc-file",
    path: "/api/sessions/cli-input-fixture/timers",
    field: "description",
  },
];

describe.each(cases)("$entry $args", (testCase) => {
  it.each(["inline", "file", "stdin"])("preserves the %s input contract and target", async (mode) => {
    // File/stdin accept frontmatter and retain trailing newlines; the existing
    // board-summary normalization still trims. Shell-like content stays literal.
    const text = `${mode === "inline" ? "Markdown" : "---\nname: fixture\n---"}\n\`code\` $(example) 'quotes' \\path\n\n`;
    const path = join(root, "input.md");
    writeFileSync(path, text);
    const input = mode === "inline" ? [testCase.inline, text] : [testCase.file, mode === "stdin" ? "-" : path];
    const result = await run(testCase.entry, [...testCase.args, ...input], mode === "stdin" ? text : "");
    expect(result.code, result.stderr).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe(testCase.path);
    const expected = testCase.trim ? text.trim() : text;
    const value =
      testCase.field === "presentation"
        ? { summary: expected }
        : testCase.field === "phaseNoteEdits"
          ? [{ index: 1, note: expected }]
          : expected;
    expect(requests[0].body[testCase.field]).toEqual(value);
    if (testCase.field === "description") expect(requests[0].body.threadKey).toBe("main");
  });

  it("rejects mixed inline/file input before mutation", async () => {
    const result = await run(testCase.entry, [...testCase.args, testCase.inline, "inline", testCase.file, "-"], "body");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("not both");
    expect(requests).toEqual([]);
  });

  it("rejects missing or unreadable file input before mutation", async () => {
    // Invalid new input paths must never fall through to default content or writes.
    for (const suffix of [[testCase.file], [testCase.file, join(root, "missing.md")]]) {
      expect((await run(testCase.entry, [...testCase.args, ...suffix])).code).not.toBe(0);
    }
    expect(requests).toEqual([]);
  });
});

it.each(
  cases.filter(({ entry }) => entry === "companion"),
)("leaves management whitespace content to the existing domain rules: $args", async (testCase) => {
  // The input transport must not introduce a whitespace-normalization policy.
  const content = " \n\t\n";
  const result = await run(testCase.entry, [...testCase.args, testCase.file, "-"], content);
  expect(result.code, result.stderr).toBe(0);
  expect(requests[0].body[testCase.field]).toBe(content);
});

it("retains empty board notes and the timer description alias", async () => {
  const note = await run("takode", ["board", "note", "q-1", "2", "--text", "", "--json"]);
  expect(note.code, note.stderr).toBe(0);
  expect(requests[0].body.phaseNoteEdits).toEqual([{ index: 1, note: "" }]);
  const timer = await run("takode", ["timer", "create", "Fixture", "--description", " \n", "--in", "1h"]);
  expect(timer.code, timer.stderr).toBe(0);
  expect(requests[1].body.description).toBe(" \n");
});

it.each(["companion", "takode"] as const)("streams a large %s message/answer to the exact target", async (entry) => {
  // Exercise the common session-send path with more than a typical argv budget,
  // plus answer target selectors. stdin must not alter bytes or invent a target.
  const content = `---\n${"literal `code` $(example)\n".repeat(12000)}\n`;
  const args =
    entry === "companion"
      ? ["sessions", "send-message", "recipient", "--stdin"]
      : ["answer", "recipient", "--target", "pending-request", "--thread", "main", "--stdin", "--json"];
  const result = await run(entry, args, content);
  expect(result.code, result.stderr).toBe(0);
  expect(requests).toEqual([
    {
      method: "POST",
      path: `/api/sessions/recipient/${entry === "companion" ? "message" : "answer"}`,
      body:
        entry === "companion"
          ? { content }
          : { response: content, callerSessionId: "cli-input-fixture", targetId: "pending-request", threadKey: "main" },
    },
  ]);
});

it("retains positional session messages and rejects mixed or empty stdin", async () => {
  const result = await run("companion", ["sessions", "send-message", "recipient", "first", "second"]);
  expect(result.code, result.stderr).toBe(0);
  expect(requests[0].body).toEqual({ content: "first second" });
  // A payload that happens to name a help flag remains a positional message.
  expect((await run("companion", ["sessions", "send-message", "recipient", "--help"])).code).toBe(0);
  expect(requests[1].body).toEqual({ content: "--help" });
  requests = [];
  for (const entry of ["companion", "takode"] as const) {
    const args = entry === "companion" ? ["sessions", "send-message", "recipient"] : ["answer", "recipient"];
    expect((await run(entry, [...args, "--stdin", "positional"], "body")).code).not.toBe(0);
    expect((await run(entry, [...args, "--stdin"])).code).not.toBe(0);
  }
  expect(requests).toEqual([]);
});

it("rejects ambiguous skill frontmatter instead of sending boolean content", async () => {
  // Regression: generic flag parsing previously sent content:true for this argv.
  for (const args of [
    ["create", "--name", "fixture"],
    ["update", "fixture"],
  ]) {
    const result = await run("companion", ["skills", ...args, "--content", "---\nname: fixture\n---\n"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--content-file");
  }
  expect(requests).toEqual([]);
});

it("rejects two independent board fields selecting stdin", async () => {
  // A cached stdin body must not silently become both the proposal and Journey.
  const result = await run("takode", ["board", "propose", "q-1", "--summary-file", "-", "--journey-file", "-"], "body");
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Only one option can read from stdin");
  expect(requests).toEqual([]);
});

it("preserves file/stdin delivery-target JSON without changing the approval endpoint", async () => {
  const target = {
    checkoutPath: "/fixture",
    remote: "origin",
    repositoryUrl: "https://example.com/repo.git",
    refs: [{ ref: "refs/heads/user/change", sha: "a".repeat(40) }],
  };
  const result = await run(
    "takode",
    ["board", "approve-delivery-target", "q-1", "--target-file", "-", "--json"],
    JSON.stringify(target),
  );
  expect(result.code, result.stderr).toBe(0);
  expect(requests).toEqual([
    { method: "POST", path: "/api/takode/board/approve-delivery-target", body: { questId: "q-1", target } },
  ]);
});

it.each([
  ["sessions", "send-message"],
  ["skills", "create"],
  ["skills", "update"],
  ["cron", "create"],
  ["cron", "update"],
])("reveals management input help without sending a request: %s %s", async (...args) => {
  // Help must work before IDs/required values are supplied and must never mutate.
  const result = await run("companion", [...args, "--help"]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toMatch(/--stdin|--content-file|--prompt-file/);
  expect(requests).toEqual([]);
});
