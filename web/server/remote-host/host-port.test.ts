import { HOST_LINK_PATH, LOCAL_HOST_ID } from "../../shared/host-protocol.js";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER, hasValidSessionToken } from "../routes/auth.js";
import { matchWebSocketRoute } from "../websocket-routes.js";
import { HostAgent, startApiProxy } from "./host-agent.js";
import { hostPortFor, hostPortGate, mainPortHostRefusal } from "./host-port.js";

describe("hostPortFor", () => {
  it("defaults to the main port plus 1000 and honors COMPANION_HOST_LINK_PORT", () => {
    expect(hostPortFor(3456, {})).toBe(4456);
    expect(hostPortFor(3456, { COMPANION_HOST_LINK_PORT: "5000" })).toBe(5000);
  });
});

/**
 * The path an agent CLI on a host takes to the coordinator: the node's API
 * proxy, then the coordinator's host port. On a shared host every local user
 * can reach both ends, so the coordinator must refuse anything that carries no
 * credential there, even with browser login off. The coordinator here is a
 * stand-in that applies the real gate and the real session-token check in
 * front of a route that always succeeds.
 */
describe("host port behind a node's API proxy", () => {
  const launcher = {
    resolveSessionId: (raw: string) => (raw === "session-1" ? raw : null),
    verifySessionAuthToken: (sessionId: string, token: string) => sessionId === "session-1" && token === "secret",
  };
  let coordinator: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startApiProxy>;

  beforeAll(() => {
    coordinator = Bun.serve({
      port: 0,
      fetch(request) {
        const refused = hostPortGate(request, {
          isHostLink: matchWebSocketRoute(new URL(request.url).pathname)?.kind === "host",
          hasSessionToken: (r) => hasValidSessionToken(r, launcher),
        });
        return refused ?? new Response("served");
      },
    });
    proxy = startApiProxy({ coordinatorUrl: `http://127.0.0.1:${coordinator.port}`, port: 0 });
  });

  afterAll(() => {
    proxy.stop();
    coordinator.stop(true);
  });

  const viaProxy = (path: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, { headers });

  it("refuses an anonymous request, through the proxy and on the host port directly", async () => {
    const proxied = await viaProxy("/api/sessions");
    expect(proxied.status).toBe(401);
    expect(await proxied.text()).toContain("host or session token");
    // Reaching the host port directly, as through a tunnel's local end, is refused the same way.
    expect((await fetch(`http://127.0.0.1:${coordinator.port}/api/sessions`)).status).toBe(401);
    // So is the frontend, which the host port does not serve to anyone without a token.
    expect((await fetch(`http://127.0.0.1:${coordinator.port}/`)).status).toBe(401);
  });

  it("refuses a request whose session token is wrong", async () => {
    const response = await viaProxy("/api/sessions", {
      [COMPANION_SESSION_ID_HEADER]: "session-1",
      [COMPANION_AUTH_TOKEN_HEADER]: "guess",
    });
    expect(response.status).toBe(401);
  });

  it("serves a request carrying a valid agent session token", async () => {
    const response = await viaProxy("/api/sessions", {
      [COMPANION_SESSION_ID_HEADER]: "session-1",
      [COMPANION_AUTH_TOKEN_HEADER]: "secret",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("served");
  });

  // The host link checks its host token itself, after the gate.
  it("leaves the host link to its own host-token check", async () => {
    const response = await fetch(`http://127.0.0.1:${coordinator.port}${HOST_LINK_PATH}`);
    expect(await response.text()).toBe("served");
  });
});

/**
 * A tunnel to the main port stays open on the host whatever the node does, so
 * while browser login is off the main port refuses other machines' hosts and
 * tells them to use the host port. This machine's own node stays on the main
 * port, and with login on the main port already requires tokens.
 */
describe("mainPortHostRefusal", () => {
  const ports = { mainPort: 3456, hostPort: 4456 };

  it("refuses a remote host while login is off, naming the host port", () => {
    expect(mainPortHostRefusal("host-1", { loginEnabled: false, ...ports })).toContain("host port 4456");
  });

  it("accepts this machine's own node and any host while login is on", () => {
    expect(mainPortHostRefusal(LOCAL_HOST_ID, { loginEnabled: false, ...ports })).toBeNull();
    expect(mainPortHostRefusal("host-1", { loginEnabled: true, ...ports })).toBeNull();
  });

  // The refusal happens before the WebSocket upgrade, which tells the node
  // nothing, so the node asks over plain HTTP and logs the reason once.
  it("reaches the node's log when the coordinator refuses its link", async () => {
    const reason = mainPortHostRefusal("host-1", { loginEnabled: false, ...ports })!;
    const coordinator = Bun.serve({ port: 0, fetch: () => new Response(reason, { status: 403 }) });
    const logs: string[] = [];
    const agent = new HostAgent({
      coordinatorUrl: `http://127.0.0.1:${coordinator.port}`,
      token: "token",
      apiProxyPort: 0,
      reconnectDelayMs: 50,
      log: (message) => logs.push(message),
    });
    try {
      agent.start();
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && logs.filter((line) => line.includes(reason)).length === 0) await Bun.sleep(20);
      // Let a few reconnects pass: the same reason is logged only once.
      await Bun.sleep(300);
      expect(
        logs.filter((line) => line.startsWith("Coordinator refused the link (403: ") && line.includes(reason)),
      ).toHaveLength(1);
    } finally {
      agent.stop();
      coordinator.stop(true);
    }
  });
});
