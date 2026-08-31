import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { FrontendAvailabilityChecker } from "../frontend-availability.js";
import type { TakodeRuntimeBuildIdentity } from "../build-identity.js";
import { createSystemRoutes } from "./system.js";
import type { RouteContext } from "./context.js";

function createTestApp(
  checkFrontendAvailability?: FrontendAvailabilityChecker,
  buildIdentity?: TakodeRuntimeBuildIdentity,
): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createSystemRoutes({
      launcher: { getPort: () => 3456 },
      wsBridge: {},
      sessionStore: {},
      worktreeTracker: {},
      terminalManager: {},
      resolveId: (raw: string) => raw,
      authenticateTakodeCaller: () => ({ response: new Response(null, { status: 401 }) }),
      authenticateCompanionCallerOptional: () => null,
      execAsync: async () => "",
      execCaptureStdoutAsync: async () => "",
      pathExists: async () => false,
      ROUTES_DIR: "/tmp",
      WEB_DIR: "/tmp",
      buildOrchestratorSystemPrompt: () => "",
      resolveInitialModeState: () => ({
        permissionMode: "default",
        askPermission: false,
        uiMode: "agent",
      }),
      checkFrontendAvailability,
      options: buildIdentity ? { buildIdentity } : undefined,
    } as unknown as RouteContext),
  );
  return app;
}

describe("system health and readiness routes", () => {
  it("keeps backend liveness healthy while reporting unavailable required frontend assets separately", async () => {
    const checker = vi.fn<FrontendAvailabilityChecker>(async () => ({
      required: true,
      ready: false,
      reason: "reference_unavailable",
    }));
    const app = createTestApp(checker);

    // Existing callers use /health as process/API liveness, so frontend readiness must not change its status or body contract.
    const healthResponse = await app.request("/api/health");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await healthResponse.json()).toMatchObject({
      ok: true,
      buildId: "development",
      servedFrontendBuildId: "development",
    });
    expect(checker).not.toHaveBeenCalled();

    const readyResponse = await app.request("/api/ready");
    expect(readyResponse.status).toBe(503);
    expect(readyResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await readyResponse.json()).toMatchObject({
      ok: false,
      buildId: "development",
      servedFrontendBuildId: "development",
      frontend: {
        required: true,
        ready: false,
        reason: "reference_unavailable",
      },
    });
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it("returns 200 when the injected frontend checker reports ready", async () => {
    const app = createTestApp(async () => ({ required: true, ready: true, reason: "ready" }));

    const response = await app.request("/api/ready");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      buildId: "development",
      servedFrontendBuildId: "development",
      frontend: { required: true, ready: true, reason: "ready" },
    });
  });

  it("reports the backend and served frontend identities independently", async () => {
    const app = createTestApp(async () => ({ required: true, ready: true, reason: "ready" }), {
      backendBuildId: null,
      servedFrontendBuildId: "build-served",
    });

    const healthResponse = await app.request("/api/health");
    expect(await healthResponse.json()).toMatchObject({
      ok: true,
      buildId: null,
      servedFrontendBuildId: "build-served",
    });

    const readyResponse = await app.request("/api/ready");
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.json()).toMatchObject({
      ok: true,
      buildId: null,
      servedFrontendBuildId: "build-served",
      frontend: { ready: true },
    });
  });

  it("defaults to ready when no frontend checker is required by the server mode", async () => {
    const app = createTestApp();

    const response = await app.request("/api/ready");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      frontend: { required: false, ready: true, reason: "not_required" },
    });
  });

  it("fails closed with a generic response when the injected checker throws", async () => {
    const app = createTestApp(async () => {
      // Filesystem errors can include private absolute paths; the unauthenticated readiness route must never reflect them.
      throw new Error("permission denied: /private/example/dist/index.html");
    });

    const response = await app.request("/api/ready");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      frontend: { required: true, ready: false, reason: "check_failed" },
    });
    expect(JSON.stringify(body)).not.toContain("/private/example");
  });
});
