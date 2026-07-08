import { randomUUID } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { DEFAULT_PORT_PROD } from "./constants.js";
import { SessionStore } from "./session-store.js";
import type { BrowserIncomingMessage } from "./session-types.js";

export type DevboxMigrationCommand = "inventory" | "export" | "import" | "start-help";

export interface DevboxMigrationOptions {
  sourceHome?: string;
  targetHome?: string;
  sourcePort?: number;
  targetPort?: number;
  packageDir?: string;
  backupRoot?: string;
  apply?: boolean;
  allowOverwrite?: boolean;
  now?: Date;
}

export interface DevboxMigrationEntry {
  id: string;
  category: "settings" | "sessions" | "quests" | "memory" | "configuration";
  sourcePath: string;
  targetPath: string;
  packagePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  fileCount: number;
  bytes: number;
  notes: string[];
}

export interface DevboxMigrationExcludedPath {
  id: string;
  path: string;
  reason: string;
  exists: boolean;
}

export interface DevboxMigrationPlan {
  sourceHome: string;
  targetHome: string;
  sourcePort: number;
  targetPort: number;
  packageDir: string;
  sourceSettingsPath?: string;
  sourceServerId?: string;
  targetSettingsPath: string;
  entries: DevboxMigrationEntry[];
  excluded: DevboxMigrationExcludedPath[];
  productionStart: DevboxProductionStartInstructions;
  notes: string[];
}

export interface DevboxMigrationManifest {
  kind: "takode-devbox-migration";
  version: 1;
  generatedAt: string;
  sourceHome: string;
  targetHome: string;
  sourcePort: number;
  targetPort: number;
  sourceServerId?: string;
  entries: Array<{
    id: string;
    category: DevboxMigrationEntry["category"];
    packagePath: string;
    targetPath: string;
    kind: "file" | "directory";
    fileCount: number;
    bytes: number;
    notes: string[];
  }>;
  excluded: DevboxMigrationExcludedPath[];
  productionStart: DevboxProductionStartInstructions;
  notes: string[];
}

export interface DevboxProductionStartInstructions {
  repoPath: string;
  port: number;
  command: string;
  serviceNotes: string[];
  validation: string[];
}

export interface DevboxMigrationExportResult {
  plan: DevboxMigrationPlan;
  manifest: DevboxMigrationManifest;
  manifestPath: string;
  packageDir: string;
}

export interface DevboxMigrationImportPlan {
  manifest: DevboxMigrationManifest;
  packageDir: string;
  targetHome: string;
  backupDir: string;
  actions: Array<{
    id: string;
    packagePath: string;
    targetPath: string;
    targetExists: boolean;
    willBackup: boolean;
    willCopy: boolean;
  }>;
  conflicts: string[];
  notes: string[];
}

export interface DevboxMigrationImportResult {
  applied: boolean;
  plan: DevboxMigrationImportPlan;
  backupManifestPath?: string;
}

interface ResolvedOptions {
  sourceHome: string;
  targetHome: string;
  sourcePort: number;
  targetPort: number;
  packageDir: string;
  backupRoot: string;
  apply: boolean;
  allowOverwrite: boolean;
  now: Date;
}

interface EntrySpec {
  id: string;
  category: DevboxMigrationEntry["category"];
  sourcePath: string;
  targetPath: string;
  packagePath: string;
  notes?: string[];
  transform?: "settings";
  excludeNames?: Set<string>;
}

const MANIFEST_FILE = "migration-manifest.json";
const PAYLOAD_DIR = "payload";
const PACKAGE_MARKER_FILE = ".takode-devbox-migration-package";
const DEFAULT_DEVBOX_REPO_PATH = "/home/coder/takode";
const SECRET_SETTING_KEYS = new Set(["pushoverUserKey", "pushoverApiToken"]);

export async function inspectDevboxMigration(options: DevboxMigrationOptions = {}): Promise<DevboxMigrationPlan> {
  const resolved = resolveOptions(options);
  const notes: string[] = [];
  const sourceSettingsPath = await resolveSourceSettingsPath(resolved.sourceHome, resolved.sourcePort);
  const sourceSettings = sourceSettingsPath ? await readJsonRecord(sourceSettingsPath) : null;
  const sourceServerId = getOptionalString(sourceSettings, "serverId");
  if (!sourceSettingsPath) {
    notes.push(
      `No source settings file found for port ${resolved.sourcePort}; import will let the target server create default settings.`,
    );
  } else if (!sourceServerId) {
    notes.push(
      `Source settings at ${sourceSettingsPath} do not contain a serverId; scoped UI config may be incomplete.`,
    );
  }

  const specs = buildEntrySpecs(resolved, sourceSettingsPath, sourceServerId);
  const entries: DevboxMigrationEntry[] = [];
  for (const spec of specs) {
    entries.push(await inspectEntry(spec));
  }

  return {
    sourceHome: resolved.sourceHome,
    targetHome: resolved.targetHome,
    sourcePort: resolved.sourcePort,
    targetPort: resolved.targetPort,
    packageDir: resolved.packageDir,
    ...(sourceSettingsPath ? { sourceSettingsPath } : {}),
    ...(sourceServerId ? { sourceServerId } : {}),
    targetSettingsPath: settingsPath(resolved.targetHome, resolved.targetPort),
    entries,
    excluded: await inspectExcludedPaths(resolved),
    productionStart: buildProductionStartInstructions(resolved.targetPort),
    notes,
  };
}

export async function exportDevboxMigrationPackage(
  options: DevboxMigrationOptions = {},
): Promise<DevboxMigrationExportResult> {
  const resolved = resolveOptions(options);
  await assertSafePackageDirForExport(resolved);
  const plan = await inspectDevboxMigration(options);
  await rm(resolved.packageDir, { recursive: true, force: true });
  await mkdir(join(resolved.packageDir, PAYLOAD_DIR), { recursive: true });
  await writeFile(join(resolved.packageDir, PACKAGE_MARKER_FILE), "takode-devbox-migration-package\n", "utf-8");

  const exportedEntries: DevboxMigrationManifest["entries"] = [];
  for (const entry of plan.entries) {
    if (!entry.exists) continue;
    const spec = buildEntrySpecs(resolved, plan.sourceSettingsPath, plan.sourceServerId).find((candidate) => {
      return candidate.id === entry.id;
    });
    if (!spec) continue;
    const destination = join(resolved.packageDir, PAYLOAD_DIR, entry.packagePath);
    await copyEntryToPackage(spec, destination);
    exportedEntries.push({
      id: entry.id,
      category: entry.category,
      packagePath: entry.packagePath,
      targetPath: entry.targetPath,
      kind: entry.kind === "directory" ? "directory" : "file",
      fileCount: entry.fileCount,
      bytes: entry.bytes,
      notes: entry.notes,
    });
  }

  const manifest: DevboxMigrationManifest = {
    kind: "takode-devbox-migration",
    version: 1,
    generatedAt: resolved.now.toISOString(),
    sourceHome: plan.sourceHome,
    targetHome: plan.targetHome,
    sourcePort: plan.sourcePort,
    targetPort: plan.targetPort,
    ...(plan.sourceServerId ? { sourceServerId: plan.sourceServerId } : {}),
    entries: exportedEntries,
    excluded: plan.excluded,
    productionStart: plan.productionStart,
    notes: plan.notes,
  };
  const manifestPath = join(resolved.packageDir, MANIFEST_FILE);
  await writeJson(manifestPath, manifest);
  return { plan, manifest, manifestPath, packageDir: resolved.packageDir };
}

export async function inspectDevboxMigrationImport(
  options: DevboxMigrationOptions = {},
): Promise<DevboxMigrationImportPlan> {
  const resolved = resolveOptions(options);
  const manifest = await readManifest(resolved.packageDir);
  const backupDir = join(resolved.backupRoot, `takode-devbox-import-${formatTimestamp(resolved.now)}`);
  const actions: DevboxMigrationImportPlan["actions"] = [];
  const conflicts: string[] = [];
  const notes: string[] = [];
  for (const entry of manifest.entries) {
    const packagePath = join(resolved.packageDir, PAYLOAD_DIR, entry.packagePath);
    const targetPath = rebaseTargetPath(entry.targetPath, manifest, resolved.targetHome);
    const targetExists = await pathExists(targetPath);
    if (targetExists && !resolved.allowOverwrite) {
      conflicts.push(targetPath);
    }
    actions.push({
      id: entry.id,
      packagePath,
      targetPath,
      targetExists,
      willBackup: resolved.apply && resolved.allowOverwrite && targetExists,
      willCopy: resolved.apply && (!targetExists || resolved.allowOverwrite),
    });
  }
  if (manifest.entries.length === 0) {
    notes.push("Package manifest has no payload entries.");
  }
  if (conflicts.length > 0) {
    notes.push("Import requires --allow-overwrite for existing target paths; target backups are made when applying.");
  }
  return {
    manifest,
    packageDir: resolved.packageDir,
    targetHome: resolved.targetHome,
    backupDir,
    actions,
    conflicts,
    notes,
  };
}

export async function importDevboxMigrationPackage(
  options: DevboxMigrationOptions = {},
): Promise<DevboxMigrationImportResult> {
  const resolved = resolveOptions(options);
  const plan = await inspectDevboxMigrationImport(options);
  if (!resolved.apply) {
    return { applied: false, plan };
  }
  if (plan.conflicts.length > 0) {
    throw new Error(
      `Refusing to import over existing target paths without --allow-overwrite:\n${plan.conflicts.join("\n")}`,
    );
  }

  await mkdir(plan.backupDir, { recursive: true });
  for (const action of plan.actions) {
    if (action.targetExists) {
      await copyPath(action.targetPath, join(plan.backupDir, relative(resolved.targetHome, action.targetPath)));
      await rm(action.targetPath, { recursive: true, force: true });
    }
    await copyPath(action.packagePath, action.targetPath);
  }
  const backupManifestPath = join(plan.backupDir, "import-backup-manifest.json");
  await writeJson(backupManifestPath, {
    kind: "takode-devbox-import-backup",
    generatedAt: resolved.now.toISOString(),
    targetHome: resolved.targetHome,
    packageDir: resolved.packageDir,
    actions: plan.actions,
  });
  return { applied: true, plan, backupManifestPath };
}

export function buildProductionStartInstructions(port = DEFAULT_PORT_PROD): DevboxProductionStartInstructions {
  return {
    repoPath: DEFAULT_DEVBOX_REPO_PATH,
    port,
    command: `cd ${DEFAULT_DEVBOX_REPO_PATH}/web && NODE_ENV=production PORT=${port} bun --no-install run start`,
    serviceNotes: [
      "Run after importing state and after any approved secret setup.",
      "Use a supervised process for the real cutover, such as systemd, tmux with documented recovery, or the workspace manager's supported startup hook.",
      "Do not stop the laptop production server until browser access, session/quest history, memory, and Codex/Claude launch paths are validated on Devbox.",
    ],
    validation: [
      `GET http://127.0.0.1:${port}/api/settings should report the expected migrated serverSlug/serverId.`,
      "Questmaster should show migrated quests and phase documentation.",
      "Session search/read should find migrated historical conversations.",
      "A new throwaway session should launch on Devbox before any production cutover.",
    ],
  };
}

function resolveOptions(options: DevboxMigrationOptions): ResolvedOptions {
  const sourceHome = options.sourceHome ?? join(homedir(), ".companion");
  const targetHome = options.targetHome ?? join(homedir(), ".companion");
  const sourcePort = options.sourcePort ?? DEFAULT_PORT_PROD;
  const targetPort = options.targetPort ?? DEFAULT_PORT_PROD;
  const now = options.now ?? new Date();
  const packageDir =
    options.packageDir ?? join(sourceHome, "devbox-migration-packages", `takode-devbox-${formatTimestamp(now)}`);
  return {
    sourceHome,
    targetHome,
    sourcePort,
    targetPort,
    packageDir,
    backupRoot: options.backupRoot ?? join(targetHome, "devbox-migration-backups"),
    apply: options.apply ?? false,
    allowOverwrite: options.allowOverwrite ?? false,
    now,
  };
}

function buildEntrySpecs(
  resolved: ResolvedOptions,
  sourceSettingsPath: string | undefined,
  sourceServerId: string | undefined,
): EntrySpec[] {
  const specs: EntrySpec[] = [];
  if (sourceSettingsPath) {
    specs.push({
      id: "settings",
      category: "settings",
      sourcePath: sourceSettingsPath,
      targetPath: settingsPath(resolved.targetHome, resolved.targetPort),
      packagePath: "settings/settings.json",
      transform: "settings",
      notes: [
        "Settings are sanitized during export: known API/token fields are blanked and settings-secrets files are excluded.",
      ],
    });
  }
  specs.push({
    id: "sessions",
    category: "sessions",
    sourcePath: join(resolved.sourceHome, "sessions", String(resolved.sourcePort)),
    targetPath: join(resolved.targetHome, "sessions", String(resolved.targetPort)),
    packagePath: "sessions",
    excludeNames: new Set(["launcher.json"]),
    notes: [
      "launcher.json is excluded so imported laptop-era sessions remain historical and are not treated as live relaunch targets.",
    ],
  });
  for (const name of ["questmaster", "questmaster-live"] as const) {
    specs.push({
      id: name,
      category: "quests",
      sourcePath: join(resolved.sourceHome, name),
      targetPath: join(resolved.targetHome, name),
      packagePath: `quests/${name}`,
    });
  }
  specs.push({
    id: "memory",
    category: "memory",
    sourcePath: join(resolved.sourceHome, "memory"),
    targetPath: join(resolved.targetHome, "memory"),
    packagePath: "memory",
    notes: ["Copies file-based memory repositories, including their Git metadata when present."],
  });
  for (const name of ["session-names.json", "auto-approval.json", "tree-groups.json"] as const) {
    specs.push({
      id: name.replace(/\.json$/, ""),
      category: "configuration",
      sourcePath: join(resolved.sourceHome, name),
      targetPath: join(resolved.targetHome, name),
      packagePath: `configuration/${name}`,
    });
  }
  if (sourceServerId) {
    specs.push({
      id: "tree-groups-scoped",
      category: "configuration",
      sourcePath: join(resolved.sourceHome, "tree-groups", `${sanitizeServerIdForPath(sourceServerId)}.json`),
      targetPath: join(resolved.targetHome, "tree-groups", `${sanitizeServerIdForPath(sourceServerId)}.json`),
      packagePath: `configuration/tree-groups/${sanitizeServerIdForPath(sourceServerId)}.json`,
    });
    specs.push({
      id: "new-session-defaults",
      category: "configuration",
      sourcePath: join(resolved.sourceHome, "new-session-defaults", `${sanitizeServerIdForPath(sourceServerId)}.json`),
      targetPath: join(resolved.targetHome, "new-session-defaults", `${sanitizeServerIdForPath(sourceServerId)}.json`),
      packagePath: `configuration/new-session-defaults/${sanitizeServerIdForPath(sourceServerId)}.json`,
    });
  }
  for (const name of ["images", "image-variants"] as const) {
    specs.push({
      id: name,
      category: "sessions",
      sourcePath: join(resolved.sourceHome, name),
      targetPath: join(resolved.targetHome, name),
      packagePath: `attachments/${name}`,
      notes: [
        "Session attachment/image state; copied so historical message file links can still resolve when paths are rebased.",
      ],
    });
  }
  return specs;
}

async function assertSafePackageDirForExport(resolved: ResolvedOptions): Promise<void> {
  const packageDir = resolve(resolved.packageDir);
  const dangerousPaths = [
    resolved.sourceHome,
    resolved.targetHome,
    homedir(),
    process.cwd(),
    dirname(process.cwd()),
  ].map((path) => resolve(path));
  for (const dangerous of dangerousPaths) {
    if (packageDir === dangerous) {
      throw new Error(`Refusing to use dangerous migration package directory: ${packageDir}`);
    }
  }
  if (looksLikeRepositoryRoot(packageDir)) {
    throw new Error(`Refusing to use repository-like migration package directory: ${packageDir}`);
  }
  const existingKind = await existingPackageDirKind(packageDir);
  if (existingKind === "missing" || existingKind === "empty" || existingKind === "owned") return;
  throw new Error(
    `Refusing to delete existing non-empty package directory without ${PACKAGE_MARKER_FILE} or ${MANIFEST_FILE}: ${packageDir}`,
  );
}

function looksLikeRepositoryRoot(path: string): boolean {
  const normalized = path.replace(/\/+$/, "");
  return normalized === resolve(process.cwd()) || basename(normalized) === ".git";
}

async function existingPackageDirKind(path: string): Promise<"missing" | "empty" | "owned" | "unsafe"> {
  try {
    const pathStat = await lstat(path);
    if (!pathStat.isDirectory()) return "unsafe";
  } catch {
    return "missing";
  }
  if (await pathExists(join(path, PACKAGE_MARKER_FILE))) return "owned";
  if (await isOwnedMigrationManifest(join(path, MANIFEST_FILE))) return "owned";
  const entries = await readdir(path);
  return entries.length === 0 ? "empty" : "unsafe";
}

async function isOwnedMigrationManifest(path: string): Promise<boolean> {
  try {
    const manifest = await readJsonRecord(path);
    return manifest.kind === "takode-devbox-migration" && manifest.version === 1;
  } catch {
    return false;
  }
}

async function inspectEntry(spec: EntrySpec): Promise<DevboxMigrationEntry> {
  const stats = await collectStats(spec.sourcePath, spec.excludeNames);
  return {
    id: spec.id,
    category: spec.category,
    sourcePath: spec.sourcePath,
    targetPath: spec.targetPath,
    packagePath: spec.packagePath,
    exists: stats.kind !== "missing",
    kind: stats.kind,
    fileCount: stats.fileCount,
    bytes: stats.bytes,
    notes: spec.notes ?? [],
  };
}

async function inspectExcludedPaths(resolved: ResolvedOptions): Promise<DevboxMigrationExcludedPath[]> {
  const excluded = [
    [
      "settings-secrets",
      settingsSecretsPath(resolved.sourceHome, resolved.sourcePort),
      "contains API keys and must be approved case-by-case",
    ],
    [
      "legacy-settings-secrets",
      join(resolved.sourceHome, "settings-secrets.json"),
      "contains API keys and must be approved case-by-case",
    ],
    ["envs", join(resolved.sourceHome, "envs"), "environment profiles may contain secrets"],
    ["session-auth", join(resolved.sourceHome, "session-auth"), "server-issued auth tokens are host/server-specific"],
    [
      "codex-home",
      join(resolved.sourceHome, "codex-home"),
      "Codex auth/plugins/session homes may contain secrets or host-specific state",
    ],
    ["logs", join(resolved.sourceHome, "logs"), "diagnostic logs are bulky and not required for migration"],
    ["recordings", join(resolved.sourceHome, "recordings"), "raw protocol recordings are bulky debugging artifacts"],
    [
      "worktrees",
      join(resolved.sourceHome, "worktrees"),
      "worktrees should be recreated or cloned on Devbox intentionally",
    ],
    ["worktrees-index", join(resolved.sourceHome, "worktrees.json"), "worktree tracking contains laptop paths"],
    ["timers", join(resolved.sourceHome, "timers"), "live timers should be reviewed before moving"],
    ["cron", join(resolved.sourceHome, "cron"), "scheduled jobs should be reviewed before moving"],
    ["resource-leases", join(resolved.sourceHome, "resource-leases"), "leases are live coordination state"],
    ["streams", join(resolved.sourceHome, "streams"), "streaming scratch state is not needed for historical migration"],
  ] as const;
  const rows: DevboxMigrationExcludedPath[] = [];
  for (const [id, path, reason] of excluded) {
    rows.push({ id, path, reason, exists: await pathExists(path) });
  }
  return rows;
}

async function copyEntryToPackage(spec: EntrySpec, destination: string): Promise<void> {
  if (spec.transform === "settings") {
    await writeJson(destination, sanitizeSettings(await readJsonRecord(spec.sourcePath)));
    return;
  }
  if (spec.id === "sessions") {
    await copySessionsToPackage(spec.sourcePath, destination, spec.excludeNames);
    const launcherEntries = await buildHistoricalLauncherCatalog(spec.sourcePath);
    await writeJson(join(destination, "launcher.json"), launcherEntries);
    return;
  }
  await copyPath(spec.sourcePath, destination, spec.excludeNames);
}

async function copySessionsToPackage(
  sourcePath: string,
  destination: string,
  excludeNames?: Set<string>,
): Promise<void> {
  await copyPath(sourcePath, destination, excludeNames);
  let files: string[];
  try {
    files = await readdir(sourcePath);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || file === "launcher.json") continue;
    const sessionId = file.replace(/\.json$/, "");
    await writeHistoricalSessionHotJson(
      join(sourcePath, file),
      join(sourcePath, `${sessionId}.history.jsonl`),
      join(destination, file),
    );
  }
}

async function writeHistoricalSessionHotJson(sourceHotPath: string, frozenLogPath: string, destinationHotPath: string) {
  let hot: Record<string, unknown>;
  try {
    hot = await readJsonRecord(sourceHotPath);
  } catch {
    return;
  }
  const hotHistory = Array.isArray(hot.messageHistory) ? (hot.messageHistory as BrowserIncomingMessage[]) : [];
  const frozenHistory = await readFrozenMessages(frozenLogPath);
  const excerpts = SessionStore.extractSearchExcerpts([...frozenHistory, ...hotHistory]);
  const archivedAt = numberOrZero(hot.archivedAt) || Date.now();
  await writeJson(destinationHotPath, {
    ...hot,
    archived: true,
    archivedAt,
    _searchExcerpts: excerpts,
  });
}

async function buildHistoricalLauncherCatalog(sessionsDir: string): Promise<Array<Record<string, unknown>>> {
  const entries: Array<Record<string, unknown>> = [];
  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return entries;
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".json") || file === "launcher.json") continue;
    const sessionPath = join(sessionsDir, file);
    let hot: Record<string, unknown>;
    try {
      hot = await readJsonRecord(sessionPath);
    } catch {
      continue;
    }
    const sessionId = typeof hot.id === "string" ? hot.id : file.replace(/\.json$/, "");
    const state = isRecord(hot.state) ? hot.state : {};
    const createdAt = numberOrZero(state.created_at) || numberOrZero(state.createdAt) || numberOrZero(hot.archivedAt);
    const archivedAt = numberOrZero(hot.archivedAt) || Date.now();
    entries.push({
      sessionId,
      state: "exited",
      exitCode: 0,
      archived: true,
      archivedAt,
      createdAt,
      lastActivityAt: numberOrUndefined(state.lastActivityAt) ?? numberOrUndefined(hot.lastReadAt),
      lastUserMessageAt: numberOrUndefined(state.lastUserMessageAt),
      model: stringOrUndefined(state.model),
      cwd: stringOrUndefined(state.cwd) ?? "",
      backendType: state.backend_type === "codex" ? "codex" : stringOrUndefined(state.backend_type),
      isWorktree: state.is_worktree === true,
      repoRoot: stringOrUndefined(state.repo_root),
      branch: stringOrUndefined(state.git_branch),
      actualBranch: stringOrUndefined(state.git_branch),
      isOrchestrator: state.isOrchestrator === true || state.is_orchestrator === true,
      treeGroupId: stringOrNullish(state.treeGroupId ?? state.tree_group_id),
      memorySessionSpaceSlug: stringOrUndefined(state.memorySessionSpaceSlug ?? state.memory_session_space_slug),
      name: stringOrUndefined(state.name),
      hidden: state.hidden === true,
    });
  }
  return entries;
}

async function readFrozenMessages(path: string): Promise<BrowserIncomingMessage[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const messages: BrowserIncomingMessage[] = [];
  let isFirstNonEmpty = true;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed) && isFirstNonEmpty && parsed.v !== undefined) {
        isFirstNonEmpty = false;
        continue;
      }
      isFirstNonEmpty = false;
      if (isRecord(parsed) && parsed._toolResults) continue;
      messages.push(parsed as BrowserIncomingMessage);
    } catch {
      // Match SessionStore's frozen-log tolerance: skip truncated/corrupt lines.
    }
  }
  return messages;
}

async function collectStats(
  path: string,
  excludeNames?: Set<string>,
): Promise<{ kind: "file" | "directory" | "missing"; fileCount: number; bytes: number }> {
  try {
    const pathStat = await lstat(path);
    if (pathStat.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      let fileCount = 0;
      let bytes = 0;
      for (const entry of entries) {
        if (excludeNames?.has(entry.name)) continue;
        const child = await collectStats(join(path, entry.name), excludeNames);
        fileCount += child.fileCount;
        bytes += child.bytes;
      }
      return { kind: "directory", fileCount, bytes };
    }
    return { kind: "file", fileCount: 1, bytes: pathStat.size };
  } catch {
    return { kind: "missing", fileCount: 0, bytes: 0 };
  }
}

async function copyPath(sourcePath: string, targetPath: string, excludeNames?: Set<string>): Promise<void> {
  const sourceStat = await lstat(sourcePath);
  await mkdir(dirname(targetPath), { recursive: true });
  if (sourceStat.isDirectory()) {
    await mkdir(targetPath, { recursive: true });
    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (excludeNames?.has(entry.name)) continue;
      await copyPath(join(sourcePath, entry.name), join(targetPath, entry.name), excludeNames);
    }
    return;
  }
  if (sourceStat.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath);
    await symlink(linkTarget, targetPath);
    return;
  }
  await cp(sourcePath, targetPath, { force: true });
}

function sanitizeSettings(input: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(input) as Record<string, unknown>;
  for (const key of SECRET_SETTING_KEYS) {
    if (typeof out[key] === "string") out[key] = "";
  }
  const namerConfig = out.namerConfig;
  if (namerConfig && typeof namerConfig === "object" && !Array.isArray(namerConfig)) {
    const cfg = namerConfig as Record<string, unknown>;
    if (typeof cfg.apiKey === "string") cfg.apiKey = "";
  }
  const transcriptionConfig = out.transcriptionConfig;
  if (transcriptionConfig && typeof transcriptionConfig === "object" && !Array.isArray(transcriptionConfig)) {
    const cfg = transcriptionConfig as Record<string, unknown>;
    if (typeof cfg.apiKey === "string") cfg.apiKey = "";
  }
  return out;
}

async function resolveSourceSettingsPath(sourceHome: string, sourcePort: number): Promise<string | undefined> {
  const portPath = settingsPath(sourceHome, sourcePort);
  if (await pathExists(portPath)) return portPath;
  const legacyPath = join(sourceHome, "settings.json");
  if (await pathExists(legacyPath)) return legacyPath;
  return undefined;
}

function settingsPath(home: string, port: number): string {
  return join(home, `settings-${port}.json`);
}

function settingsSecretsPath(home: string, port: number): string {
  return join(home, `settings-secrets-${port}.json`);
}

function sanitizeServerIdForPath(serverId: string): string {
  return serverId.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "local";
}

function formatTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
}

function rebaseTargetPath(path: string, manifest: DevboxMigrationManifest, targetHome: string): string {
  const originalHome = manifest.targetHome || commonTargetHome(manifest.entries.map((entry) => entry.targetPath));
  if (originalHome && (path === originalHome || path.startsWith(`${originalHome}/`))) {
    return join(targetHome, relative(originalHome, path));
  }
  return path;
}

function commonTargetHome(paths: string[]): string {
  if (paths.length === 0) return "";
  const parts = paths[0].split("/");
  while (parts.length > 1) {
    const candidate = parts.join("/") || "/";
    if (paths.every((path) => path === candidate || path.startsWith(`${candidate}/`))) return candidate;
    parts.pop();
  }
  return "";
}

async function readManifest(packageDir: string): Promise<DevboxMigrationManifest> {
  const parsed = await readJsonRecord(join(packageDir, MANIFEST_FILE));
  if (parsed.kind !== "takode-devbox-migration" || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`Expected a Takode Devbox migration manifest at ${join(packageDir, MANIFEST_FILE)}.`);
  }
  return parsed as unknown as DevboxMigrationManifest;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object at ${path}.`);
  }
  return parsed as Record<string, unknown>;
}

function getOptionalString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tempPath, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringOrNullish(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringOrUndefined(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
