import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createSystemRoutes } from "./system.js";
import { WsBridge } from "../ws-bridge.js";

function createTestApp(wsBridge: WsBridge): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createSystemRoutes({
      launcher: { getPort: () => 3456 },
      wsBridge,
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
    } as any),
  );
  return app;
}

describe("VS Code selection REST routes", () => {
  it("updates the real bridge browser transport state for panel-closed extension publishes", async () => {
    const bridge = new WsBridge();
    const app = createTestApp(bridge);

    // Regression coverage for the VS Code panel-closed path: the extension posts
    // directly to REST, so the route must reach WsBridge's browser transport state.
    const res = await app.request("/api/vscode/selection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selection: {
          absolutePath: "/repo/src/app.ts",
          startLine: 10,
          endLine: 12,
          lineCount: 3,
        },
        updatedAt: 2000,
        sourceId: "vscode-window:test",
        sourceType: "vscode-window",
        sourceLabel: "VS Code",
      }),
    });

    const expectedState = {
      selection: {
        absolutePath: "/repo/src/app.ts",
        startLine: 10,
        endLine: 12,
        lineCount: 3,
      },
      updatedAt: 2000,
      sourceId: "vscode-window:test",
      sourceType: "vscode-window",
      sourceLabel: "VS Code",
    };
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: expectedState });
    expect((bridge as any).browserTransportState.vscodeSelectionState).toEqual(expectedState);
  });
});
