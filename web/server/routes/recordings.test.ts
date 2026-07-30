import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderManager } from "../recorder.js";
import type { RouteContext } from "./context.js";
import { createRecordingsRoutes } from "./recordings.js";

describe("recording routes with automatic capture disabled", () => {
  let root: string;
  let recordingsDir: string;
  let recorder: RecorderManager;
  let app: Hono;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "recording-routes-test-"));
    recordingsDir = join(root, "recordings");
    recorder = new RecorderManager({ globalEnabled: false, recordingsDir });
    const launcher = {
      getSession: vi.fn((id: string) =>
        id === "s1" ? { sessionId: id, sdkDebugLogPath: "/tmp/claude-sdk-s1.log" } : undefined,
      ),
    };
    const context = {
      launcher,
      recorder,
      resolveId: (raw: string) => (raw === "s1" || raw === "s2" ? raw : null),
    } as unknown as RouteContext;
    app = new Hono();
    app.route("/api", createRecordingsRoutes(context));
  });

  afterEach(() => {
    recorder.closeAll();
    rmSync(root, { recursive: true, force: true });
  });

  it("starts and stops only the selected session while status stays authoritative", async () => {
    const start = await app.request("/api/sessions/s1/recording/start", { method: "POST" });
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ ok: true, recording: true });
    expect(recorder.isRecording("s1")).toBe(true);
    expect(recorder.isRecording("s2")).toBe(false);
    expect(existsSync(recordingsDir)).toBe(false);

    recorder.record("s1", "in", "selected", "browser", "claude", "/cwd");
    recorder.record("s2", "in", "not selected", "browser", "claude", "/cwd");

    const activeStatus = await app.request("/api/sessions/s1/recording/status");
    expect(activeStatus.status).toBe(200);
    expect(await activeStatus.json()).toEqual({
      recording: true,
      available: true,
      recordingsDir,
      globalEnabled: false,
      sdkDebugFile: "/tmp/claude-sdk-s1.log",
      filePath: expect.stringContaining("s1_claude_"),
    });

    const stop = await app.request("/api/sessions/s1/recording/stop", { method: "POST" });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ ok: true, recording: false });

    const stoppedStatus = await app.request("/api/sessions/s1/recording/status");
    expect(await stoppedStatus.json()).toEqual({
      recording: false,
      available: true,
      recordingsDir,
      globalEnabled: false,
      sdkDebugFile: "/tmp/claude-sdk-s1.log",
    });

    const listing = await app.request("/api/recordings");
    expect(await listing.json()).toEqual({
      recordings: [expect.objectContaining({ sessionId: "s1", backendType: "claude" })],
    });
  });
});
