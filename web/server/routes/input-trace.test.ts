import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const settings = vi.hoisted(() => ({ diagnostics: { inputTrace: false } }));
vi.mock("../settings-manager.js", () => ({ getSettings: () => settings }));
import { createLogsRoutes } from "./logs.js";
import { InputTraceStore } from "../input-trace-store.js";
import type { RouteContext } from "./context.js";

const roots: string[] = [];
afterEach(async () => {
  settings.diagnostics.inputTrace = false;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("automatic trace routes", () => {
  it("requires opt-in, keeps list responses compact, and reveals only a selected time range", async () => {
    const path = await mkdtemp(join(tmpdir(), "input-trace-routes-"));
    roots.push(path);
    const ctx = { authenticateCompanionCallerOptional: () => ({ callerId: "fixture" }) } as unknown as RouteContext;
    const app = createLogsRoutes(ctx, new InputTraceStore(path));
    const now = Date.now();
    const batch = {
      traceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recordingSince: now - 1000,
      userAgent: "browser",
      platform: "MacIntel",
      events: [
        { seq: 1, t: now - 500, type: "paste", length: 33 },
        { seq: 2, t: now, type: "input", length: 82 },
      ],
    };
    const post = () =>
      app.request("/diagnostics/input-trace/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      });
    expect((await post()).status).toBe(409);
    settings.diagnostics.inputTrace = true;
    expect((await post()).status).toBe(200);
    const list = await (await app.request("/diagnostics/input-trace")).json();
    expect(list.traces[0]).toMatchObject({ trace: "aaaaaaaa", eventCount: 2 });
    expect(JSON.stringify(list)).not.toContain('"events"');
    const detail = await (await app.request(`/diagnostics/input-trace?trace=aaaaaaaa&since=${now}&limit=1`)).json();
    expect(detail.events).toEqual([batch.events[1]]);
    expect((await app.request("/diagnostics/input-trace?trace=aaaaaaaa&since=bad-time")).status).toBe(400);
    const unauthorized = createLogsRoutes(
      { authenticateCompanionCallerOptional: () => null } as unknown as RouteContext,
      new InputTraceStore(path),
    );
    expect((await unauthorized.request("/diagnostics/input-trace")).status).toBe(403);
  });
});
