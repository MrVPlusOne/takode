import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOneOffProdPort3455To3456Migration } from "./one-off-prod-port-3455-to-3456.js";

describe("one-off-prod-port-3455-to-3456", () => {
  let companionHome: string;

  beforeEach(async () => {
    companionHome = await mkdtemp(join(tmpdir(), "one-off-prod-port-migration-"));
  });

  afterEach(async () => {
    await rm(companionHome, { recursive: true, force: true });
  });

  it("inspects the expected machine-specific migration shape without mutating state", async () => {
    // This validates the operator preflight path: the script should discover
    // the exact source/target artifacts without creating backup output yet.
    const sourcePort = 40155;
    const targetPort = 40156;
    const sourceServerId = "source-server";
    const targetServerId = "target-server";
    await seedFixture(companionHome, { sourcePort, targetPort, sourceServerId, targetServerId });

    const beforeTargetSettings = await readJson(join(companionHome, `settings-${targetPort}.json`));
    const beforeAuth = await readJson(join(companionHome, "session-auth", `cwd-a-${sourceServerId}.json`));

    const result = await runOneOffProdPort3455To3456Migration({
      companionHome,
      sourcePort,
      targetPort,
      now: new Date("2026-04-27T19:00:00Z"),
    });

    expect(result.applied).toBe(false);
    expect(result.plan.sourceServerId).toBe(sourceServerId);
    expect(result.plan.targetServerId).toBe(targetServerId);
    expect(result.plan.sourceSessionAuthPaths).toHaveLength(2);
    expect(result.plan.targetSessionAuthPaths).toHaveLength(1);
    expect(result.plan.willPatchPushoverBaseUrl).toBe(true);
    expect(result.plan.pushoverBaseUrlAfter).toBe(`http://localhost:${targetPort}`);
    expect(await pathExists(join(companionHome, "port-migrations"))).toBe(false);
    expect(await readJson(join(companionHome, `settings-${targetPort}.json`))).toEqual(beforeTargetSettings);
    expect(await readJson(join(companionHome, "session-auth", `cwd-a-${sourceServerId}.json`))).toEqual(beforeAuth);
  });

  it("backs up and materializes the 3456 takeover state on a fixture", async () => {
    // This covers the real operator-run behavior on a temp fixture: backups,
    // target replacement, pushover rewrite, and in-place session-auth updates.
    const sourcePort = 40165;
    const targetPort = 40166;
    const sourceServerId = "source-server";
    const targetServerId = "target-server";
    await seedFixture(companionHome, { sourcePort, targetPort, sourceServerId, targetServerId });

    const fixedNow = new Date("2026-04-27T20:15:00Z");
    const result = await runOneOffProdPort3455To3456Migration({
      companionHome,
      sourcePort,
      targetPort,
      apply: true,
      now: fixedNow,
    });

    expect(result.applied).toBe(true);
    expect(result.rewrittenSessionAuthCount).toBe(2);

    const migratedSettings = await readJson(join(companionHome, `settings-${targetPort}.json`));
    expect(migratedSettings.serverId).toBe(sourceServerId);
    expect(migratedSettings.serverName).toBe("Macbook");
    expect(migratedSettings.pushoverBaseUrl).toBe(`http://localhost:${targetPort}`);

    const targetSecrets = await readJson(join(companionHome, `settings-secrets-${targetPort}.json`));
    expect(targetSecrets.transcriptionApiKey).toBe("source-secret");

    expect(await readFile(join(companionHome, "sessions", String(targetPort), "source.json"), "utf-8")).toBe(
      "source-session",
    );
    expect(await pathExists(join(companionHome, "sessions", String(targetPort), "target.json"))).toBe(false);

    const rewrittenAuth = await readJson(join(companionHome, "session-auth", `cwd-a-${sourceServerId}.json`));
    expect(rewrittenAuth.port).toBe(targetPort);
    expect(rewrittenAuth.serverId).toBe(sourceServerId);

    const legacyTreeGroups = await readJson(join(companionHome, "tree-groups.json"));
    expect(legacyTreeGroups).toEqual({ groups: [{ id: "legacy", name: "Legacy" }] });

    const backupDir = result.plan.backupDir;
    expect(await pathExists(join(backupDir, "source", `settings-${sourcePort}.json`))).toBe(true);
    expect(await pathExists(join(backupDir, "source", "session-auth", `cwd-a-${sourceServerId}.json`))).toBe(true);
    expect(await pathExists(join(backupDir, "target", `settings-${targetPort}.json`))).toBe(true);
    expect(await pathExists(join(backupDir, "target", "tree-groups.json"))).toBe(true);
    expect(await pathExists(result.manifestPath!)).toBe(true);
    expect(await pathExists(result.rollbackScriptPath!)).toBe(true);
  });
});

async function seedFixture(
  companionHome: string,
  options: { sourcePort: number; targetPort: number; sourceServerId: string; targetServerId: string },
): Promise<void> {
  const { sourcePort, targetPort, sourceServerId, targetServerId } = options;
  await mkdir(join(companionHome, "sessions", String(sourcePort)), { recursive: true });
  await mkdir(join(companionHome, "sessions", String(targetPort)), { recursive: true });
  await mkdir(join(companionHome, "tree-groups"), { recursive: true });
  await mkdir(join(companionHome, "session-auth"), { recursive: true });

  await writeJson(join(companionHome, `settings-${sourcePort}.json`), {
    serverName: "Macbook",
    serverId: sourceServerId,
    pushoverBaseUrl: `http://localhost:${sourcePort}`,
    autoApprovalEnabled: true,
  });
  await writeJson(join(companionHome, `settings-${targetPort}.json`), {
    serverName: "",
    serverId: targetServerId,
    pushoverBaseUrl: "",
    autoApprovalEnabled: false,
  });
  await writeJson(join(companionHome, `settings-secrets-${sourcePort}.json`), {
    transcriptionApiKey: "source-secret",
  });

  await writeFile(join(companionHome, "sessions", String(sourcePort), "source.json"), "source-session", "utf-8");
  await writeFile(join(companionHome, "sessions", String(targetPort), "target.json"), "target-session", "utf-8");

  await writeJson(join(companionHome, "tree-groups", `${sourceServerId}.json`), {
    groups: [{ id: "default", name: "Default" }],
    assignments: { a: "default" },
    nodeOrder: {},
  });
  await writeJson(join(companionHome, "tree-groups.json"), {
    groups: [{ id: "legacy", name: "Legacy" }],
  });

  await writeJson(join(companionHome, "session-auth", `cwd-a-${sourceServerId}.json`), {
    sessionId: "a",
    authToken: "token-a",
    port: sourcePort,
    serverId: sourceServerId,
  });
  await writeJson(join(companionHome, "session-auth", `cwd-b-${sourceServerId}.json`), {
    sessionId: "b",
    authToken: "token-b",
    port: sourcePort,
    serverId: sourceServerId,
  });
  await writeJson(join(companionHome, "session-auth", `cwd-c-${targetServerId}.json`), {
    sessionId: "c",
    authToken: "token-c",
    port: targetPort,
    serverId: targetServerId,
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}
