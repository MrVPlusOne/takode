import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
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
    state: { session_id: "session-a" },
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
  });
  await writeFile(join(root, "sessions", "3456", "session-a.history.jsonl"), '{"type":"user_message"}\n');
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

  it("exports a package without launcher metadata or settings secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "takode-devbox-source-"));
    const packageDir = await mkdtemp(join(tmpdir(), "takode-devbox-package-"));
    await seedSourceHome(root);

    const result = await exportDevboxMigrationPackage({ sourceHome: root, packageDir });

    // Historical conversations are copied, but launcher/auth material must not enter the portable package.
    expect(result.manifest.entries.map((entry) => entry.id)).toContain("sessions");
    await expect(readFile(join(packageDir, "payload", "sessions", "launcher.json"), "utf-8")).rejects.toThrow();
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
});
