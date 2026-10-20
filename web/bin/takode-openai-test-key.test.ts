import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
let server: Server | null = null;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "takode-openai-test-key-"));
});

afterEach(async () => {
  server?.close();
  server = null;
  await rm(home, { recursive: true, force: true });
});

/** A stand-in Takode server that answers the access check and the test-key route. */
async function startServer(apiKey: string | null): Promise<number> {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/api/takode/me") res.end(JSON.stringify({ sessionId: "worker", isOrchestrator: false }));
    else if (req.url === "/api/settings/openai-test-key")
      res.end(JSON.stringify({ apiKey, baseUrl: "https://api.openai.com/v1" }));
    else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  server.listen(0);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function runTakode(port: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, "openai-test-key", "--port", String(port)], {
    env: { ...process.env, HOME: home, COMPANION_SESSION_ID: "worker", COMPANION_AUTH_TOKEN: "token" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const [status] = await once(child, "close");
  return { status: status as number | null, stdout, stderr };
}

describe("takode openai-test-key", () => {
  // Callers substitute the output straight into OPENAI_API_KEY, so stdout must be the bare key.
  it("prints only the test key", async () => {
    const result = await runTakode(await startServer("sk-test"));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("sk-test\n");
  });

  // An unset test key must stop the caller rather than leave it to find another key.
  it("fails with a pointer to the setting when no test key is set", async () => {
    const result = await runTakode(await startServer(null));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Settings > Voice > Test Key for Agents");
  });
});
