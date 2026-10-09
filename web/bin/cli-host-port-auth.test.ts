import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasValidSessionToken } from "../server/routes/auth.js";
import { startApiProxy } from "../server/remote-host/host-agent.js";
import { hostPortGate } from "../server/remote-host/host-port.js";

async function runCli(
  entry: "takode.ts" | "cli.ts",
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
) {
  const script = fileURLToPath(new URL(`./${entry}`, import.meta.url));
  const child = spawn(process.execPath, [script, ...args], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
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

/**
 * A session on a remote host reaches the coordinator through its node's API
 * proxy and the coordinator's token-only host port. `takode host` and the
 * `companion` management commands also work from a plain terminal, so their
 * session headers are optional, but from a session they must send them or the
 * host port refuses the call. The coordinator here applies the real gate and
 * session-token check in front of stub routes.
 */
describe("management CLIs through the token-only host port", () => {
  const launcher = {
    resolveSessionId: (raw: string) => (raw === "session-1" ? raw : null),
    verifySessionAuthToken: (sessionId: string, token: string) => sessionId === "session-1" && token === "secret",
  };
  let coordinator: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startApiProxy>;
  let home: string;

  beforeAll(() => {
    coordinator = Bun.serve({
      port: 0,
      fetch(request) {
        const refused = hostPortGate(request, {
          isHostLink: false,
          hasSessionToken: (r) => hasValidSessionToken(r, launcher),
        });
        if (refused) return refused;
        const path = new URL(request.url).pathname;
        if (path === "/api/hosts") return Response.json({ hosts: [] });
        if (path === "/api/sessions") return Response.json([{ sessionId: "session-1" }]);
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    proxy = startApiProxy({ coordinatorUrl: `http://127.0.0.1:${coordinator.port}`, port: 0 });
    // Disposable HOME and cwd so the CLIs cannot pick up a real session-auth file.
    home = mkdtempSync(join(tmpdir(), "cli-host-port-auth-"));
  });

  afterAll(() => {
    proxy.stop();
    coordinator.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  const env = (session: Record<string, string | undefined>) => ({
    ...process.env,
    HOME: home,
    COMPANION_PORT: String(proxy.port),
    COMPANION_SESSION_ID: undefined,
    COMPANION_AUTH_TOKEN: undefined,
    ...session,
  });
  const sessionEnv = () => env({ COMPANION_SESSION_ID: "session-1", COMPANION_AUTH_TOKEN: "secret" });

  it("serves takode host list from a session", async () => {
    const result = await runCli("takode.ts", ["host", "list"], sessionEnv(), home);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No hosts registered");
  });

  it("serves companion management commands from a session", async () => {
    const result = await runCli("cli.ts", ["sessions", "list"], sessionEnv(), home);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ sessionId: "session-1" }]);
  });

  it("still refuses the same commands without session credentials", async () => {
    const result = await runCli("takode.ts", ["host", "list"], env({}), home);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("host or session token");
  });
});
