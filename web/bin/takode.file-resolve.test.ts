import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
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

  child.stdin?.end();

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

function createSessionInfoServer(sessions: Record<string, JsonObject>) {
  return createServer((req, res) => {
    const method = req.method || "";
    const url = req.url || "";

    if (method === "GET" && url === "/api/takode/me") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "leader-file-resolve", isOrchestrator: true }));
      return;
    }

    const match = url.match(/^\/api\/sessions\/([^/]+)\/info$/);
    if (method === "GET" && match) {
      const session = sessions[decodeURIComponent(match[1] ?? "")];
      if (!session) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(session));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

async function withServer<T>(sessions: Record<string, JsonObject>, run: (port: number) => Promise<T>): Promise<T> {
  const server = createSessionInfoServer(sessions);
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    return await run(port);
  } finally {
    server.close();
  }
}

function createSessionPayload(cwd: string, overrides: JsonObject = {}): JsonObject {
  return {
    sessionId: "worker-file-resolve",
    sessionNum: 1656,
    name: "File Resolve Worker",
    state: "idle",
    cwd,
    createdAt: 123,
    cliConnected: true,
    isGenerating: false,
    isWorktree: true,
    ...overrides,
  };
}

describe("takode file-resolve", () => {
  it("resolves multiple relative paths, file links, Markdown file links, and absolute file links in order", async () => {
    const root = mkdtempSync(join(tmpdir(), "takode-file-resolve-"));
    const artifactsDir = join(root, "artifacts");
    mkdirSync(artifactsDir);
    const relativePreview = "artifacts/preview.png";
    const markdownPreview = "artifacts/markdown-preview.png";
    const absolutePreview = join(root, "absolute-preview.png");
    writeFileSync(join(root, relativePreview), "relative");
    writeFileSync(join(root, markdownPreview), "markdown");
    writeFileSync(absolutePreview, "absolute");

    try {
      await withServer({ "1656": createSessionPayload(root) }, async (port) => {
        const result = await runTakode(
          [
            "file-resolve",
            "--session",
            "1656",
            relativePreview,
            `file:${relativePreview}`,
            `[preview](file:${markdownPreview})`,
            `file:${absolutePreview}`,
            "--port",
            String(port),
          ],
          {
            ...process.env,
            COMPANION_SESSION_ID: "leader-file-resolve",
            COMPANION_AUTH_TOKEN: "auth-file-resolve",
          },
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout.trim().split("\n")).toEqual([
          join(root, relativePreview),
          join(root, relativePreview),
          join(root, markdownPreview),
          absolutePreview,
        ]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("outputs compact JSON without dumping bulky session internals", async () => {
    const root = mkdtempSync(join(tmpdir(), "takode-file-resolve-json-"));
    const preview = "artifacts/preview.png";
    mkdirSync(join(root, "artifacts"));
    writeFileSync(join(root, preview), "preview");

    try {
      await withServer(
        {
          worker: createSessionPayload(root, {
            injectedSystemPrompt: "large prompt that must not be echoed",
            taskHistory: [{ title: "large history" }],
          }),
        },
        async (port) => {
          const result = await runTakode(
            ["file-resolve", "--session=worker", "--json", preview, "--port", String(port)],
            {
              ...process.env,
              COMPANION_SESSION_ID: "leader-file-resolve",
              COMPANION_AUTH_TOKEN: "auth-file-resolve",
            },
          );

          expect(result.status).toBe(0);
          const parsed = JSON.parse(result.stdout) as JsonObject;
          expect(parsed).toEqual({
            session: "worker",
            root,
            results: [{ input: preview, path: join(root, preview) }],
          });
          expect(result.stdout).not.toContain("injectedSystemPrompt");
          expect(result.stdout).not.toContain("taskHistory");
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports missing sessions through a compact error", async () => {
    await withServer({}, async (port) => {
      const result = await runTakode(
        ["file-resolve", "--session", "missing", "artifacts/preview.png", "--port", String(port)],
        {
          ...process.env,
          COMPANION_SESSION_ID: "leader-file-resolve",
          COMPANION_AUTH_TOKEN: "auth-file-resolve",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({ error: "Session not found" });
    });
  });

  it("rejects sessions without a usable absolute filesystem context", async () => {
    await withServer({ worker: createSessionPayload("relative/path") }, async (port) => {
      const result = await runTakode(["file-resolve", "--session", "worker", "preview.png", "--port", String(port)], {
        ...process.env,
        COMPANION_SESSION_ID: "leader-file-resolve",
        COMPANION_AUTH_TOKEN: "auth-file-resolve",
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "Session worker has no usable filesystem context: missing absolute cwd.",
      });
    });
  });

  it("treats mixed valid and invalid multi-input batches as atomic failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "takode-file-resolve-mixed-"));
    const valid = "valid.txt";
    const missing = "missing.txt";
    writeFileSync(join(root, valid), "valid");

    try {
      await withServer({ worker: createSessionPayload(root) }, async (port) => {
        const result = await runTakode(
          ["file-resolve", "--session", "worker", valid, missing, "--port", String(port)],
          {
            ...process.env,
            COMPANION_SESSION_ID: "leader-file-resolve",
            COMPANION_AUTH_TOKEN: "auth-file-resolve",
          },
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr)).toEqual({
          error: "Could not resolve 1 input.",
          session: "worker",
          errors: [{ input: missing, error: `File does not exist: ${join(root, missing)}` }],
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects relative inputs that escape the session cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "takode-file-resolve-escape-"));
    const outside = join(tmpdir(), `${basename(root)}-outside.txt`);
    writeFileSync(outside, "outside");

    try {
      await withServer({ worker: createSessionPayload(root) }, async (port) => {
        const result = await runTakode(
          ["file-resolve", "--session", "worker", "../outside.txt", "--port", String(port)],
          {
            ...process.env,
            COMPANION_SESSION_ID: "leader-file-resolve",
            COMPANION_AUTH_TOKEN: "auth-file-resolve",
          },
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr)).toEqual({
          error: "Could not resolve 1 input.",
          session: "worker",
          errors: [{ input: "../outside.txt", error: "Relative path escapes the session filesystem context." }],
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });

  it("resolves archived or disconnected sessions when cwd metadata remains usable", async () => {
    const root = mkdtempSync(join(tmpdir(), "takode-file-resolve-archived-"));
    const preview = "preview.png";
    writeFileSync(join(root, preview), "preview");

    try {
      await withServer(
        {
          worker: createSessionPayload(root, {
            archived: true,
            cliConnected: false,
            state: "exited",
          }),
        },
        async (port) => {
          const result = await runTakode(["file-resolve", "--session", "worker", preview, "--port", String(port)], {
            ...process.env,
            COMPANION_SESSION_ID: "leader-file-resolve",
            COMPANION_AUTH_TOKEN: "auth-file-resolve",
          });

          expect(result.status).toBe(0);
          expect(result.stdout.trim()).toBe(join(root, preview));
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
