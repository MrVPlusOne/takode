/**
 * What a Takode Codex session carries over from the user's own Codex home
 * (normally `~/.codex`). Each session keeps its own `CODEX_HOME`, so Takode's
 * per-session instructions and catalogs stay isolated and Takode threads stay
 * out of the user's Codex app; these helpers bring over what the user set up
 * there: their settings (refreshed at every launch), installed plugins, hooks,
 * their own developer instructions and the login key their provider reads from
 * the environment.
 */
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

/** Entries of the user's Codex home every session uses live, through a link. */
const linkedUserHomeEntries = ["plugins", "hooks.json"] as const;

/** The session config Takode last wrote, so a launch can tell the session's own edits apart. */
const configBaselineFilename = ".takode-config-baseline.toml";

/**
 * Link the user's installed plugins and `hooks.json` into a session home, or
 * drop a link whose source is gone. A real file or folder the session made
 * itself is left alone.
 */
export async function linkCodexUserHomeEntries(codexHome: string, userCodexHome: string): Promise<void> {
  for (const name of linkedUserHomeEntries) {
    const source = join(userCodexHome, name);
    const dest = join(codexHome, name);
    const destStat = await lstat(dest).catch(() => null);
    if (destStat && !destStat.isSymbolicLink()) {
      console.warn(`[cli-launcher] ${dest} is the session's own, so it does not use ${source}`);
      continue;
    }
    const sourceExists = await stat(source).then(
      () => true,
      () => false,
    );
    if (destStat && sourceExists && (await readlink(dest)) === source) continue;
    if (destStat) await unlink(dest);
    if (sourceExists) await symlink(source, dest);
  }
}

/**
 * Rebuild a session's `config.toml` from the user's current Codex config.
 *
 * Settings come from the user's config, so edits there reach relaunched
 * sessions. A table or top-level key the session changed since Takode last
 * wrote the file (`baseline`), such as an MCP server toggled in Takode, keeps
 * the session's version; one the session removed stays removed. A home from
 * before this refresh has no baseline, so nothing tells its own edits apart:
 * it keeps its config once, and refreshes from its next launch on. Takode
 * applies its own keys after this, so they never need to survive here.
 */
export function refreshCodexSessionConfig(input: { session?: string; user: string; baseline?: string }): string {
  if (input.session !== undefined && input.baseline === undefined) return input.session;
  const fresh = splitTomlUnits(input.user);
  const freshKeys = new Set(fresh.map((unit) => unit.key));
  const session = input.session === undefined ? [] : splitTomlUnits(input.session);
  const sessionByKey = new Map(session.map((unit) => [unit.key, unit]));
  const baselineByKey = new Map(splitTomlUnits(input.baseline ?? "").map((unit) => [unit.key, unit]));
  const sessionChanged = (unit: TomlUnit) => {
    const before = baselineByKey.get(unit.key);
    return !before || tomlUnitValue(before) !== tomlUnitValue(unit);
  };

  const kept: TomlUnit[] = [];
  for (const unit of fresh) {
    const own = sessionByKey.get(unit.key);
    if (own && sessionChanged(own)) kept.push(own);
    else if (!own && input.session !== undefined && baselineByKey.has(unit.key)) continue;
    else kept.push(unit);
  }
  for (const unit of session) {
    if (!freshKeys.has(unit.key) && sessionChanged(unit)) kept.push(unit);
  }
  // Top-level keys must come before the first table.
  const ordered = [...kept.filter((unit) => !unit.table), ...kept.filter((unit) => unit.table)];
  const text = ordered
    .map((unit) => (unit.table ? `\n${unit.text}` : unit.text))
    .join("\n")
    .replace(/^\n+/, "");
  return text === "" ? text : `${text}\n`;
}

/**
 * Read what refreshing a session's config needs: the user's config, with its
 * hook approvals moved to the session's paths, and the config Takode last
 * wrote. Undefined when the session home is the user's own.
 */
export async function readCodexUserConfigSources(
  codexHome: string,
  userCodexHome: string,
  runtimeCodexHome = codexHome,
): Promise<{ user: string; baseline?: string } | undefined> {
  if (resolve(codexHome) === resolve(userCodexHome)) return undefined;
  const readOptional = (path: string) => readFile(path, "utf-8").catch(() => undefined);
  const [user, baseline] = await Promise.all([
    readOptional(join(userCodexHome, "config.toml")),
    readOptional(join(codexHome, configBaselineFilename)),
  ]);
  return { user: rehomeCodexHookApprovals(user ?? "", userCodexHome, runtimeCodexHome), baseline };
}

/** Remember the config Takode wrote for a session, for the next launch's refresh. */
export async function saveCodexSessionConfigBaseline(codexHome: string, configToml: string): Promise<void> {
  const path = join(codexHome, configBaselineFilename);
  if ((await readFile(path, "utf-8").catch(() => undefined)) === configToml) return;
  await writeFile(path, configToml, "utf-8");
}

/** The user's own `developer_instructions` from their Codex config, if any. */
export function readUserCodexDeveloperInstructions(userConfigToml: string): string | undefined {
  if (!userConfigToml.includes("developer_instructions")) return undefined;
  try {
    const value = (Bun.TOML.parse(userConfigToml) as Record<string, unknown>).developer_instructions;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch (error) {
    console.warn("[cli-launcher] Could not read developer_instructions from the user's Codex config:", error);
    return undefined;
  }
}

/** Takode's instructions for a Codex session with the user's own developer instructions added. */
export function withUserCodexDeveloperInstructions(
  takodeInstructions: string | undefined,
  userInstructions: string | undefined,
): string | undefined {
  if (!userInstructions) return takodeInstructions;
  const section = [
    "## The user's own Codex developer instructions",
    "",
    "The user set these as `developer_instructions` in their own Codex configuration, which every Codex session they run follows.",
    "",
    userInstructions,
  ].join("\n");
  return takodeInstructions ? `${takodeInstructions}\n\n${section}` : section;
}

const providerEnvCache = new Map<string, string | null>();

/**
 * Values of the environment variables a Codex model provider reads its key
 * from (`env_key`). A server started outside the user's shell lacks variables
 * the shell profile sets, so missing ones are read once from a login shell.
 */
export async function captureCodexProviderEnv(names: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const value = process.env[name] || providerEnvCache.get(name);
    if (value) result[name] = value;
    else if (!providerEnvCache.has(name)) missing.push(name);
  }
  if (missing.length === 0) return result;

  const captured = await readLoginShellEnv(missing);
  for (const name of missing) {
    providerEnvCache.set(name, captured[name] ?? null);
    if (captured[name]) result[name] = captured[name];
  }
  return result;
}

/** Forget login-shell values read for providers (tests). */
export function _resetCodexProviderEnvCacheForTest(): void {
  providerEnvCache.clear();
}

async function readLoginShellEnv(names: string[]): Promise<Record<string, string>> {
  const shell = process.env.SHELL || "/bin/bash";
  const script = names.map((name) => `echo "___ENV_${name}___=\${${name}:-}"`).join("; ");
  try {
    // Promisified here, not at load: many tests replace node:child_process without execFile.
    const { stdout } = await promisify(execFile)(shell, ["-lic", script], {
      timeout: 10_000,
      killSignal: "SIGKILL",
      env: { HOME: homedir(), USER: process.env.USER, SHELL: shell },
    });
    const values: Record<string, string> = {};
    for (const name of names) {
      const value = new RegExp(`___ENV_${name}___=(.*)`).exec(stdout)?.[1];
      if (value) values[name] = value;
    }
    return values;
  } catch (error) {
    console.warn(`[cli-launcher] Could not read ${names.join(", ")} from the user's login shell:`, error);
    return {};
  }
}

/**
 * Codex keys hook approvals (`[hooks.state]`) by the path of the file that
 * declares the hook, so approvals made in the user's home would not cover the
 * session's copy of `hooks.json` or `config.toml` without moving them.
 */
function rehomeCodexHookApprovals(configToml: string, userCodexHome: string, sessionCodexHome: string): string {
  let out = configToml;
  for (const file of ["hooks.json", "config.toml"]) {
    out = out.replaceAll(`"${join(userCodexHome, file)}:`, `"${join(sessionCodexHome, file)}:`);
  }
  return out;
}

/** A top-level key (with its value) or a table (with its keys) of a TOML file. */
interface TomlUnit {
  key: string;
  table: boolean;
  text: string;
}

function splitTomlUnits(toml: string): TomlUnit[] {
  const units: TomlUnit[] = [];
  const tableCounts = new Map<string, number>();
  let current: TomlUnit | undefined;
  let inTable = false;
  let pending: string[] = [];
  let state: TomlScanState = { multiline: null, depth: 0 };
  for (const line of toml.replace(/\r\n/g, "\n").split("\n")) {
    const continuing = state.multiline !== null || state.depth > 0;
    const trimmed = line.trim();
    if (!continuing && trimmed.startsWith("[")) {
      const header = normalizeTomlKey(stripTomlComment(trimmed));
      const count = tableCounts.get(header) ?? 0;
      tableCounts.set(header, count + 1);
      current = {
        key: header.startsWith("[[") ? `${header}#${count}` : header,
        table: true,
        text: [...pending, line].join("\n"),
      };
      units.push(current);
      pending = [];
      inTable = true;
      continue;
    }
    if (current && (inTable || continuing)) {
      current.text += `\n${line}`;
    } else if (trimmed === "" || trimmed.startsWith("#")) {
      pending.push(line);
      continue;
    } else {
      const equals = findTomlKeyEnd(trimmed);
      current = { key: normalizeTomlKey(trimmed.slice(0, equals)), table: false, text: [...pending, line].join("\n") };
      units.push(current);
      pending = [];
    }
    state = scanTomlLine(line, state);
  }
  const trailing = pending.join("\n").trim();
  if (trailing && current) current.text += `\n${pending.join("\n")}`;
  return units.map((unit) => ({ ...unit, text: unit.text.replace(/\n+$/, "") }));
}

interface TomlScanState {
  multiline: '"""' | "'''" | null;
  depth: number;
}

/** Track open multi-line strings and arrays/inline tables across a line. */
function scanTomlLine(line: string, state: TomlScanState): TomlScanState {
  let { multiline, depth } = state;
  let i = 0;
  while (i < line.length) {
    if (multiline) {
      const end = line.indexOf(multiline, i);
      if (end < 0) return { multiline, depth };
      i = end + 3;
      multiline = null;
      continue;
    }
    const ch = line[i];
    if (ch === "#") break;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      multiline = line.slice(i, i + 3) as '"""' | "'''";
      i += 3;
    } else if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
      i++;
    } else if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      i = end < 0 ? line.length : end + 1;
    } else {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      i++;
    }
  }
  return { multiline, depth };
}

/** Index of the `=` ending a key, skipping quoted key parts. */
function findTomlKeyEnd(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "=") {
      return i;
    }
  }
  return line.length;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i).trim();
    }
  }
  return line;
}

function normalizeTomlKey(key: string): string {
  return key.trim().replace(/\s*([[\].])\s*/g, "$1");
}

/** A unit's meaning, so reformatting (as Codex's own config writes do) is not an edit. */
function tomlUnitValue(unit: TomlUnit): string {
  try {
    return canonicalJson(Bun.TOML.parse(unit.text));
  } catch {
    return unit.text.trim();
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
