import { HOST_HOP_TIMING_METRIC } from "../latency-log.js";
import { insecureCoordinatorUrlProblem, startApiProxy } from "./host-agent.js";

describe("insecureCoordinatorUrlProblem", () => {
  // The host token and all session traffic cross this link, so plain http is
  // only accepted on this machine (or a local tunnel) unless explicitly allowed.
  it("accepts https and loopback http and refuses other plain http unless allowed", () => {
    expect(insecureCoordinatorUrlProblem("https://takode.example.com", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://127.0.0.1:3456", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://localhost:3456", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://10.0.0.5:3456", false)).toContain("not encrypted");
    expect(insecureCoordinatorUrlProblem("http://10.0.0.5:3456", true)).toBeNull();
    expect(insecureCoordinatorUrlProblem("ftp://host", true)).toContain("must start with https:// or http://");
    expect(insecureCoordinatorUrlProblem("not a url", false)).toContain("Not a valid coordinator URL");
  });
});

describe("startApiProxy", () => {
  /** A loopback port nothing listens on yet. */
  function freePort(): number {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    return port;
  }

  // Sessions on a host keep running while the coordinator restarts, so their
  // CLI calls wait for it instead of failing: a request is held while the host
  // link is down, sent again while the coordinator's port refuses connections,
  // and delivered exactly once when the coordinator is back.
  it("holds a request while the coordinator is away and delivers it once when it returns", async () => {
    const port = freePort();
    let connected = false;
    const proxy = startApiProxy({
      coordinatorUrl: `http://127.0.0.1:${port}`,
      port: 0,
      coordinatorConnected: () => connected,
      waitMs: 10_000,
    });
    const received: string[] = [];
    let coordinator: ReturnType<typeof Bun.serve> | null = null;
    try {
      const pending = fetch(`http://127.0.0.1:${proxy.port}/api/quests`, { method: "POST", body: "write once" });
      await Bun.sleep(300);
      // The link is back but the coordinator's port still refuses connections.
      connected = true;
      await Bun.sleep(300);
      coordinator = Bun.serve({
        port,
        fetch: async (request) => {
          received.push(await request.text());
          return new Response("ok");
        },
      });
      const response = await pending;
      expect(await response.text()).toBe("ok");
      expect(received).toEqual(["write once"]);
      expect(response.headers.get("server-timing")).toContain(HOST_HOP_TIMING_METRIC);
    } finally {
      coordinator?.stop(true);
      proxy.stop();
    }
  });

  // A coordinator that stays away does not hold the request forever.
  it("fails the request after the wait", async () => {
    const proxy = startApiProxy({
      coordinatorUrl: `http://127.0.0.1:${freePort()}`,
      port: 0,
      coordinatorConnected: () => true,
      waitMs: 300,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/api/quests`);
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("is unreachable");
    } finally {
      proxy.stop();
    }
  });
});
