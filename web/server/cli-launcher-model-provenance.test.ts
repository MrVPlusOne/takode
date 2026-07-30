import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliLauncher } from "./cli-launcher.js";
import {
  createModelProvenanceMigration,
  resolveUnknownModelProvenanceAuthority,
} from "./cli-launcher-model-authority.js";
import { SessionStore } from "./session-store.js";
import type { SdkSessionInfo } from "./session-info.js";

describe("CliLauncher legacy model provenance", () => {
  let tempDir: string;
  let launcher: CliLauncher;
  let store: SessionStore;
  let configuredDefault: string;
  let spawnCodex: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "model-provenance-"));
    launcher = new CliLauncher(3456, { serverId: "test-server" });
    store = new SessionStore(tempDir);
    launcher.setStore(store);
    configuredDefault = "gpt-5.6-terra";
    launcher.setSettingsGetter(() => ({
      claudeBinary: "",
      codexBinary: "codex",
      sessionDefaults: { codex: { model: configuredDefault } },
    }));
    spawnCodex = vi.spyOn(launcher as any, "spawnCodex").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("migrates legacy relaunch once, launches the chosen model, and persists the warning", async () => {
    const legacy: SdkSessionInfo = {
      sessionId: "legacy-session",
      state: "exited",
      model: "legacy-unknown",
      cwd: tempDir,
      createdAt: 1,
      backendType: "codex",
    };
    (launcher as unknown as { sessions: Map<string, SdkSessionInfo> }).sessions.set(legacy.sessionId, legacy);
    const migrationEvents = vi.fn();
    launcher.onModelProvenanceMigrationCallback(migrationEvents);
    const saveLauncher = vi.spyOn(store, "saveLauncher");

    expect(await launcher.relaunch(legacy.sessionId)).toEqual({ ok: true });
    expect(legacy).toMatchObject({
      model: "gpt-5.6-terra",
      modelAuthority: { source: "session_default" },
      modelProvenanceMigration: { source: "legacy_relaunch", selectedModel: "gpt-5.6-terra" },
    });
    expect(spawnCodex).toHaveBeenCalledWith(
      legacy.sessionId,
      legacy,
      expect.objectContaining({ model: "gpt-5.6-terra" }),
    );
    expect(migrationEvents).toHaveBeenCalledOnce();
    const firstMigration = legacy.modelProvenanceMigration;
    firstMigration!.acknowledgedAt = 456;

    configuredDefault = "gpt-5.6-luna";
    expect(await launcher.relaunch(legacy.sessionId)).toEqual({ ok: true });
    expect(legacy.model).toBe("gpt-5.6-terra");
    expect(legacy.modelProvenanceMigration).toBe(firstMigration);
    expect(legacy.modelProvenanceMigration).toMatchObject({ eventId: firstMigration!.eventId, acknowledgedAt: 456 });
    expect(migrationEvents).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(200);
    expect(saveLauncher).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: legacy.sessionId,
        model: "gpt-5.6-terra",
        modelAuthority: expect.objectContaining({ source: "session_default" }),
        modelProvenanceMigration: firstMigration,
      }),
    ]);
  });

  it("persists and announces a one-time external-resume migration at launch", async () => {
    const authority = resolveUnknownModelProvenanceAuthority("gpt-5.6-terra");
    const migration = createModelProvenanceMigration(authority, "external_resume", 123);
    const migrationEvents = vi.fn();
    launcher.onModelProvenanceMigrationCallback(migrationEvents);

    const info = await launcher.launch({
      backendType: "codex",
      cwd: tempDir,
      model: authority.model,
      modelAuthority: authority,
      modelProvenanceMigration: migration,
      modelProvenanceMigrationCreated: true,
      resumeCliSessionId: "external-thread",
    });

    expect(info).toMatchObject({
      model: "gpt-5.6-terra",
      modelAuthority: authority,
      modelProvenanceMigration: migration,
    });
    expect(spawnCodex).toHaveBeenCalledWith(
      info.sessionId,
      info,
      expect.objectContaining({ model: "gpt-5.6-terra", resumeCliSessionId: "external-thread" }),
    );
    expect(migrationEvents).toHaveBeenCalledWith(info.sessionId, migration);
  });
});
