import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function run(args: string[], port: number) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./takode.ts", import.meta.url)), ...args], {
    env: {
      ...process.env,
      TAKODE_API_PORT: String(port),
      COMPANION_SESSION_ID: "worker",
      COMPANION_AUTH_TOKEN: "fixture-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

describe("takode worktree", () => {
  it("lets an authenticated worker register its checkout and list compact metadata without leader authority", async () => {
    // The CLI talks only to this disposable local HTTP fixture, never Takode.
    const requests: Array<{ path: string; body: unknown }> = [];
    const record = {
      sessionId: "worker",
      path: "/fixture/aux",
      branch: "feature",
      baseBranch: "integration",
      retention: "temporary",
      cleanupStatus: null,
      cleanupReason: null,
    };
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      requests.push({ path: req.url!, body: raw ? JSON.parse(raw) : null });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/takode/me") {
        res.end(JSON.stringify({ sessionId: "worker", isOrchestrator: false }));
      } else if (req.url === "/api/sessions/worker/worktrees") {
        res.end(JSON.stringify(req.method === "POST" ? { worktree: record } : { worktrees: [record] }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Unexpected fixture request" }));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const port = (server.address() as AddressInfo).port;
      const registered = await run(
        ["worktree", "register", "/fixture/aux", "--retention", "temporary", "--base", "integration"],
        port,
      );
      expect(registered.code).toBe(0);
      expect(registered.stdout).toContain("temporary");
      expect(registered.stdout).toContain("preserved");
      expect(requests).toContainEqual({
        path: "/api/sessions/worker/worktrees",
        body: { path: "/fixture/aux", retention: "temporary", baseBranch: "integration" },
      });
      const listed = await run(["worktree", "list", "--json"], port);
      expect(listed.code).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual({ worktrees: [record] });
      const invalid = await run(["worktree", "register", "/fixture/aux"], port);
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain("retention");
      const help = await run(["help", "worktree"], port);
      expect(help.stdout).toContain("temporary|retained");
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
