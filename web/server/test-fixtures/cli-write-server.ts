/**
 * A real quest and memory write server for CLI tests. It mounts the production
 * quest routes and memory command route over the quest and memory stores of
 * whatever HOME it starts with, so tests must start it with a disposable HOME
 * (see `startCliWriteServer`). Sessions are stubs: every session id is known,
 * every auth token is accepted, and ids listed in TAKODE_TEST_LEADER_IDS act as
 * leaders. TAKODE_TEST_SERVER_SLUG sets the server slug that names memory repos.
 */
import { Hono } from "hono";
import { validateCompanionAuth } from "../routes/auth.js";
import { createMemoryRoutes } from "../routes/memory.js";
import { createQuestRoutes } from "../routes/quests.js";
import type { RouteContext } from "../routes/context.js";
import { _flushForTest, getServerSlug, initWithPort, updateSettings } from "../settings-manager.js";

const leaderIds = new Set((process.env.TAKODE_TEST_LEADER_IDS ?? "").split(",").filter(Boolean));

const launcher = {
  getSession: (sessionId: string) => ({ sessionId, state: "connected", isOrchestrator: leaderIds.has(sessionId) }),
  listSessions: () => [],
  getMemorySessionSpaceSlug: () => "Takode",
  verifySessionAuthToken: () => true,
};

// The routes notify live browsers and sessions through the bridge; there are none here.
const wsBridge = new Proxy({}, { get: (_target, property) => (property === "then" ? undefined : () => undefined) });

const resolveId = (raw: string) => raw;
const ctx = {
  launcher,
  wsBridge,
  resolveId,
  authenticateCompanionCallerOptional: (c: import("hono").Context) =>
    validateCompanionAuth(c, launcher as never, resolveId, { required: false, headerLabel: "Companion" }),
  execCaptureStdoutAsync: async () => "",
} as unknown as RouteContext;

const app = new Hono();
app.route("/api", createQuestRoutes(ctx));
app.route("/api", createMemoryRoutes(ctx));

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
// Like the real server, settings (server slug and id) belong to the listening port.
await initWithPort(server.port!);
if (process.env.TAKODE_TEST_SERVER_SLUG) updateSettings({ serverSlug: process.env.TAKODE_TEST_SERVER_SLUG });
getServerSlug();
// CLIs sharing this HOME read the same port-scoped settings file.
await _flushForTest();
console.log(JSON.stringify({ port: server.port }));
