import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingRunnerApi } from "./takode-land.js";

/**
 * A landing runner renews its port lease every other heartbeat and gives up
 * the push once a renewal fails. A Restart Server takes the server away for a
 * minute or two while the lease itself survives, so a renewal that cannot reach
 * the server must not count as losing the lease: that threw away gate runs that
 * had passed across a restart. A renewal the server refuses still does.
 */
describe("landing runner lease renewal", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  beforeEach(() => {
    vi.stubEnv("COMPANION_SESSION_ID", "landing-runner");
    vi.stubEnv("COMPANION_AUTH_TOKEN", "secret");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server?.stop(true);
    server = undefined;
  });

  it("does not report a lost lease while the server cannot be reached", async () => {
    // Bind a port, then close it, so connecting is refused as during a restart.
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const base = `http://127.0.0.1:${closed.port}/api`;
    await closed.stop(true);

    await expect(landingRunnerApi(base).renewLease()).resolves.toBeUndefined();
  });

  it("does not report a lost lease while the server answers 503 on its way back", async () => {
    server = Bun.serve({ port: 0, fetch: () => Response.json({ error: "Service Unavailable" }, { status: 503 }) });

    await expect(landingRunnerApi(`http://127.0.0.1:${server.port}/api`).renewLease()).resolves.toBeUndefined();
  });

  it("reports a lost lease when the server refuses the renewal", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "The landing run no longer holds the port lease." }, { status: 409 }),
    });

    await expect(landingRunnerApi(`http://127.0.0.1:${server.port}/api`).renewLease()).rejects.toThrow(
      "no longer holds the port lease",
    );
  });
});
