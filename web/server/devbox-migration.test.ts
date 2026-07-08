import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import { searchSessionDocuments } from "./session-search.js";
import {
  exportDevboxMigrationPackage,
  importDevboxMigrationPackage,
  inspectDevboxMigration,
  inspectDevboxMigrationImport,
} from "./devbox-migration.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

async function seedSourceHome(root: string): Promise<void> {
  await writeJson(join(root, "settings-3456.json"), {
    serverId: "server-1",
    serverSlug: "prod",
    pushoverUserKey: "secret-user",
    pushoverApiToken: "secret-token",
    namerConfig: { backend: "openai", apiKey: "secret-namer", baseUrl: "https://example.test", model: "m" },
    transcriptionConfig: { apiKey: "secret-stt", baseUrl: "https://example.test" },
  });
  await writeJson(join(root, "settings-secrets-3456.json"), { namerOpenAIApiKey: "secret" });
  await writeJson(join(root, "sessions", "3456", "session-a.json"), {
    id: "session-a",
    state: {
      session_id: "session-a",
      cwd: "/Users/jiayiwei/Code/companion",
      backend_type: "codex",
      model: "gpt-5.5",
    },
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
  });
  await writeFile(
    join(root, "sessions", "3456", "session-a.history.jsonl"),
    `${JSON.stringify({ v: 1 })}\n${JSON.stringify({
      type: "user_message",
      id: "history-only-user",
      content: "history-only-search-term lives in the frozen log",
      timestamp: 123,
    })}\n`,
  );
  await writeJson(join(root, "sessions", "3456", "launcher.json"), [{ sessionId: "session-a", state: "running" }]);
  await writeJson(join(root, "questmaster-live", "store.json"), { quests: [] });
  await writeJson(join(root, "questmaster", "q-1-v1.json"), { id: "q-1" });
  await mkdir(join(root, "memory", "prod", "Takode"), { recursive: true });
  await writeFile(join(root, "memory", "prod", "Takode", "knowledge.md"), "memory\n");
  await writeJson(join(root, "tree-groups", "server-1.json"), { groups: [], assignments: {}, nodeOrder: {} });
  await writeJson(join(root, "new-session-defaults", "server-1.json"), { entries: {} });
  await writeJson(join(root, "envs", "secret-env.json"), { variables: { TOKEN: "secret" } });
}

describe("devbox migration planner", () => {
  it("plans core state and excludes secret-bearing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    await seedSourceHome(root);

    // The inventory is the operator's review surface before any export or import happens.
    const plan = await inspectDevboxMigration({ sourceHome: root, targetHome: "/home/coder/.companion" });

    expect(plan.sourceServerId).toBe("server-1");
    expect(plan.entries.find((entry) => entry.id === "sessions")?.fileCount).toBe(2);
    expect(plan.entries.find((entry) => entry.id === "settings")?.notes.join(" ")).toContain("sanitized");
    expect(plan.excluded.find((entry) => entry.id === "settings-secrets")?.exists).toBe(true);
    expect(plan.excluded.find((entry) => entry.id === "envs")?.exists).toBe(true);
  });

  it("exports a package with an archived launcher catalog and without settings secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(root);

    const result = await exportDevboxMigrationPackage({ sourceHome: root, packageDir });

    // Historical conversations are copied with a read-only launcher catalog, not live launcher/auth material.
    expect(result.manifest.entries.map((entry) => entry.id)).toContain("sessions");
    const launcher = JSON.parse(await readFile(join(packageDir, "payload", "sessions", "launcher.json"), "utf-8"));
    expect(launcher).toEqual([
      expect.objectContaining({
        sessionId: "session-a",
        state: "exited",
        archived: true,
        backendType: "codex",
        model: "gpt-5.5",
      }),
    ]);
    expect(launcher[0]).not.toHaveProperty("pid");
    expect(launcher[0]).not.toHaveProperty("sessionAuthToken");
    expect(launcher[0]).not.toHaveProperty("cliSessionId");
    await expect(
      readFile(join(packageDir, "payload", "settings", "settings-secrets-3456.json"), "utf-8"),
    ).rejects.toThrow();
    const settings = JSON.parse(await readFile(join(packageDir, "payload", "settings", "settings.json"), "utf-8"));
    expect(settings.pushoverUserKey).toBe("");
    expect(settings.namerConfig.apiKey).toBe("");
    expect(settings.transcriptionConfig.apiKey).toBe("");
  });

  it("reports import conflicts in dry-run without changing target files", async () => {
    const source = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const target = await mkdtemp(join(tmpdir(), "takode-devbox-target-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(source);
    await writeJson(join(target, "settings-3456.json"), { serverId: "target" });
    await exportDevboxMigrationPackage({ sourceHome: source, packageDir });

    // Dry-run import should be safe on an existing Devbox state directory.
    const plan = await inspectDevboxMigrationImport({ packageDir, targetHome: target });

    expect(plan.conflicts).toContain(join(target, "settings-3456.json"));
    expect(JSON.parse(await readFile(join(target, "settings-3456.json"), "utf-8")).serverId).toBe("target");
  });

  it("applies import with overwrite only after backing up existing target paths", async () => {
    const source = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const target = await mkdtemp(join(tmpdir(), "takode-devbox-target-"));
    const backupRoot = await mkdtemp(join(tmpdir(), "takode-devbox-backups-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(source);
    await writeJson(join(target, "settings-3456.json"), { serverId: "target" });
    await exportDevboxMigrationPackage({ sourceHome: source, packageDir });

    // Apply mode may replace target state only after creating an auditable backup.
    const result = await importDevboxMigrationPackage({
      packageDir,
      targetHome: target,
      backupRoot,
      apply: true,
      allowOverwrite: true,
      now: new Date("2026-07-08T00:00:00Z"),
    });

    expect(result.applied).toBe(true);
    expect(JSON.parse(await readFile(join(target, "settings-3456.json"), "utf-8")).serverId).toBe("server-1");
    expect(JSON.parse(await readFile(join(result.plan.backupDir, "settings-3456.json"), "utf-8")).serverId).toBe(
      "target",
    );
  });

  it("imports historical sessions as archived launcher catalog entries that SessionStore can read", async () => {
    const source = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const target = await mkdtemp(join(tmpdir(), "takode-devbox-target-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(source);
    await exportDevboxMigrationPackage({ sourceHome: source, packageDir });

    await importDevboxMigrationPackage({ packageDir, targetHome: target, apply: true });

    const store = new SessionStore(join(target, "sessions", "3456"));
    const launcher = await store.loadLauncher<Array<Record<string, unknown>>>();
    expect(launcher?.[0]).toEqual(expect.objectContaining({ sessionId: "session-a", state: "exited", archived: true }));
    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("session-a");
    expect(sessions[0].archived).toBe(true);
    expect(sessions[0]._searchDataOnly).toBe(true);
  });

  it("makes frozen history-only content searchable after import through SessionStore search data", async () => {
    const source = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const target = await mkdtemp(join(tmpdir(), "takode-devbox-target-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(source);
    await exportDevboxMigrationPackage({ sourceHome: source, packageDir });
    await importDevboxMigrationPackage({ packageDir, targetHome: target, apply: true });

    const store = new SessionStore(join(target, "sessions", "3456"));
    const [session] = await store.loadAll();

    const results = searchSessionDocuments(
      [
        {
          sessionId: session.id,
          state: "exited",
          archived: true,
          createdAt: 0,
          messageHistory: session.messageHistory,
          searchExcerpts: session._searchExcerpts,
        },
      ],
      { query: "history-only-search-term", includeArchived: true },
    );

    expect(session.messageHistory).toEqual([]);
    expect(session._searchExcerpts?.some((excerpt) => excerpt.content.includes("history-only-search-term"))).toBe(true);
    expect(results.totalMatches).toBe(1);
    expect(results.results[0].matchedField).toBe("user_message");
  });

  it("refuses to export into source home or existing unowned directories", async () => {
    const source = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const unowned = await mkdtemp(join(tmpdir(), "takode-devbox-unowned-"));
    await seedSourceHome(source);
    await writeFile(join(unowned, "important.txt"), "do not delete\n");

    await expect(exportDevboxMigrationPackage({ sourceHome: source, packageDir: source })).rejects.toThrow(
      /dangerous migration package directory/,
    );
    await expect(exportDevboxMigrationPackage({ sourceHome: source, packageDir: unowned })).rejects.toThrow(
      /existing non-empty package directory/,
    );
    expect(await readFile(join(unowned, "important.txt"), "utf-8")).toBe("do not delete\n");
  });
});
