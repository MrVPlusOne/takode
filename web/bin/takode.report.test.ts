import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("publishes through the actual command with authenticated exact bytes and a compact receipt", async () => {
  // All filesystem and HTTP effects are confined to this temporary fixture.
  const root = await mkdtemp(join(tmpdir(), "report-command-"));
  let received: any;
  let auth: string | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/takode/me") {
      res.end(JSON.stringify({ sessionId: "host", isOrchestrator: true }));
      return;
    }
    if (req.url !== "/api/takode/reports") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    auth = req.headers["x-companion-auth-token"] as string;
    res.end(
      JSON.stringify({
        reportId: "report",
        sessionId: "host",
        threadKey: "main",
        bytes: 20000,
        sha256: "a".repeat(64),
      }),
    );
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const path = join(root, "daily.md");
    const content = "# Original\r\n" + "Full report detail.\n".repeat(1000);
    await writeFile(path, content);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./takode.ts", import.meta.url)),
        "report",
        path,
        "--thread",
        "main",
        "--worker",
        "12",
        "--json",
        "--port",
        String((server.address() as AddressInfo).port),
      ],
      {
        env: { ...process.env, COMPANION_SESSION_ID: "host", COMPANION_AUTH_TOKEN: "fixture-token" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const [code] = await once(child, "close");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(received).toEqual({ sourcePath: path, content, threadKey: "main", responsibleWorkerId: "12" });
    expect(auth).toBe("fixture-token");
    expect(JSON.parse(stdout)).toMatchObject({ reportId: "report", bytes: 20000 });
    expect(stdout).not.toContain("Full report detail");
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
