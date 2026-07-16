import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { CodexUpstreamProgressProxyRegistry } from "./codex-upstream-progress-proxy.js";

const MAI_LITELLM_PROVIDER = "mai-litellm";
const UPSTREAM_MARKER = "takode-copilot-progress-upstream-base-url";
const WRAPPER_UPSTREAM_MARKER = "takode-copilot-progress-upstream-litellm-proxy-url";
const PROXY_PATH_MARKER = "/api/codex-upstream-progress-proxy/";
const MAI_WRAPPER_ROOT_MARKER = ".mai-agents-root";
const MAI_WRAPPER_ENV_HOST_PREFIX = "companion-codex-home-";

type ProgressProxyConfigResult = {
  enabled: boolean;
  changed: boolean;
  source?: "config" | "mai-wrapper-env";
  upstreamBaseUrl?: string;
  proxyBaseUrl?: string;
};

export async function configureCodexUpstreamProgressProxy(options: {
  sessionId: string;
  registry: CodexUpstreamProgressProxyRegistry | null;
  spawnCmd: string[];
  spawnEnv: Record<string, string | undefined>;
  containerized?: boolean;
}): Promise<ProgressProxyConfigResult> {
  if (!options.registry || options.containerized || !options.spawnEnv.CODEX_HOME) {
    return { enabled: false, changed: false };
  }

  const wrapperResult = await ensureMaiWrapperEnvProxy({
    sessionId: options.sessionId,
    registry: options.registry,
    spawnCmd: options.spawnCmd,
    spawnEnv: options.spawnEnv,
  });
  if (wrapperResult.enabled) return wrapperResult;

  return ensureCodexUpstreamProgressProxyConfig(options.spawnEnv.CODEX_HOME, {
    sessionId: options.sessionId,
    registry: options.registry,
  });
}

export async function ensureCodexUpstreamProgressProxyConfig(
  codexHome: string,
  options: {
    sessionId: string;
    registry: CodexUpstreamProgressProxyRegistry;
    containerized?: boolean;
    providerNames?: readonly string[];
  },
): Promise<ProgressProxyConfigResult> {
  const configPath = join(codexHome, "config.toml");
  const current = await readFile(configPath, "utf-8").catch(() => "");
  const selectedProvider = readTopLevelStringSetting(current, "model_provider")?.trim().toLowerCase();
  const providerNames = options.providerNames ?? [MAI_LITELLM_PROVIDER];
  if (!selectedProvider || !providerNames.includes(selectedProvider)) {
    return { enabled: false, changed: false };
  }

  const sectionHeader = "[model_providers." + selectedProvider + "]";
  const baseUrl = readStringSettingInSection(current, sectionHeader, "base_url")?.trim();
  if (!baseUrl) return { enabled: false, changed: false };

  const markerUpstream = readUpstreamMarkerInSection(current, sectionHeader);
  const upstreamBaseUrl = isTakodeProxyUrl(baseUrl) ? markerUpstream : baseUrl;
  if (!upstreamBaseUrl || isTakodeProxyUrl(upstreamBaseUrl)) return { enabled: false, changed: false };

  const proxyBaseUrl = options.registry.registerSessionUpstream(options.sessionId, upstreamBaseUrl, {
    containerized: options.containerized,
  });
  const next = upsertProviderBaseUrlWithMarker(current, sectionHeader, proxyBaseUrl, upstreamBaseUrl);
  if (next !== current) await writeFile(configPath, next, "utf-8");
  return { enabled: true, changed: next !== current, source: "config", upstreamBaseUrl, proxyBaseUrl };
}

function isTakodeProxyUrl(value: string): boolean {
  return value.includes(PROXY_PATH_MARKER);
}

async function ensureMaiWrapperEnvProxy(options: {
  sessionId: string;
  registry: CodexUpstreamProgressProxyRegistry;
  spawnCmd: string[];
  spawnEnv: Record<string, string | undefined>;
}): Promise<ProgressProxyConfigResult> {
  const wrapperRoot = await resolveMaiWrapperRoot(options.spawnCmd[0]);
  if (!wrapperRoot) return { enabled: false, changed: false };

  const overlayHostname = normalizeMaiHostname(MAI_WRAPPER_ENV_HOST_PREFIX + options.sessionId);
  const envPath = join(wrapperRoot, ".run", ".env-" + overlayHostname);
  const current = await readFile(envPath, "utf-8").catch(() => "");
  if (!current) return { enabled: false, changed: false };

  const baseUrl = readShellEnvAssignment(current, "LITELLM_PROXY_URL")?.trim();
  if (!baseUrl) return { enabled: false, changed: false };
  const markerUpstream = readShellCommentMarker(current, WRAPPER_UPSTREAM_MARKER);
  const upstreamBaseUrl = isTakodeProxyUrl(baseUrl) ? markerUpstream : baseUrl;
  if (!upstreamBaseUrl || isTakodeProxyUrl(upstreamBaseUrl)) return { enabled: false, changed: false };

  const proxyBaseUrl = options.registry.registerSessionUpstream(options.sessionId, upstreamBaseUrl);
  const next = upsertShellEnvAssignmentWithMarker(
    current,
    "LITELLM_PROXY_URL",
    proxyBaseUrl,
    WRAPPER_UPSTREAM_MARKER,
    upstreamBaseUrl,
  );
  if (next !== current) await writeFile(envPath, next, "utf-8");
  options.spawnEnv.LITELLM_PROXY_URL = proxyBaseUrl;
  return { enabled: true, changed: next !== current, source: "mai-wrapper-env", upstreamBaseUrl, proxyBaseUrl };
}

async function resolveMaiWrapperRoot(binary: string | undefined): Promise<string | null> {
  if (!binary || basename(binary) !== "codex.sh") return null;
  const root = dirname(binary);
  try {
    await access(join(root, MAI_WRAPPER_ROOT_MARKER));
    return root;
  } catch {
    return null;
  }
}

function readTopLevelStringSetting(configToml: string, key: string): string | undefined {
  const lines = configToml.split("\n");
  const keyPattern = new RegExp("^\\s*" + escapeRegExp(key) + "\\s*=\\s*(.+?)\\s*$");
  for (const line of lines) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) break;
    const value = readTomlStringFromLine(line, keyPattern);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readStringSettingInSection(configToml: string, sectionHeader: string, key: string): string | undefined {
  const section = findSection(configToml, sectionHeader);
  if (!section) return undefined;
  const keyPattern = new RegExp("^\\s*" + escapeRegExp(key) + "\\s*=\\s*(.+?)\\s*$");
  for (let i = section.start + 1; i < section.end; i++) {
    const value = readTomlStringFromLine(section.lines[i], keyPattern);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readTomlStringFromLine(line: string, keyPattern: RegExp): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const match = line.match(keyPattern);
  if (!match?.[1]) return undefined;
  const raw = match[1].trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return raw.replace(/\s+#.*$/, "").trim();
}

function readShellEnvAssignment(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp("^" + escapeRegExp(key) + "=(.*)$", "m"));
  if (!match) return undefined;
  return decodeShellValue(match[1]?.trim() || "");
}

function readShellCommentMarker(raw: string, marker: string): string | undefined {
  const match = raw.match(new RegExp("^\\s*#\\s*" + escapeRegExp(marker) + "\\s*=\\s*(.+?)\\s*$", "m"));
  return match?.[1] ? decodeShellValue(match[1].trim()) : undefined;
}

function decodeShellValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/'\\\\''/g, "'");
  }
  return raw;
}

function quoteShellEnvValue(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function readUpstreamMarkerInSection(configToml: string, sectionHeader: string): string | undefined {
  const section = findSection(configToml, sectionHeader);
  if (!section) return undefined;
  const markerPattern = new RegExp("^\\s*#\\s*" + escapeRegExp(UPSTREAM_MARKER) + "\\s*=\\s*(.+?)\\s*$");
  for (let i = section.start + 1; i < section.end; i++) {
    const match = section.lines[i].match(markerPattern);
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw;
  }
  return undefined;
}

function upsertShellEnvAssignmentWithMarker(
  raw: string,
  key: string,
  value: string,
  marker: string,
  upstreamBaseUrl: string,
): string {
  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const markerPattern = new RegExp("^\\s*#\\s*" + escapeRegExp(marker) + "\\s*=");
  const keyPattern = new RegExp("^" + escapeRegExp(key) + "=");
  const out = lines.filter((line) => !markerPattern.test(line));
  const markerLine = "# " + marker + " = " + JSON.stringify(upstreamBaseUrl);
  const assignment = key + "=" + quoteShellEnvValue(value);
  const index = out.findIndex((line) => keyPattern.test(line));
  if (index === -1) {
    out.push(markerLine, assignment);
  } else {
    out.splice(index, 1, markerLine, assignment);
  }
  return out.join("\n") + (endsWithNewline || raw.length === 0 ? "\n" : "");
}

function upsertProviderBaseUrlWithMarker(
  configToml: string,
  sectionHeader: string,
  proxyBaseUrl: string,
  upstreamBaseUrl: string,
): string {
  const endsWithNewline = configToml.endsWith("\n");
  const lines = configToml.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const section = findSectionFromLines(lines, sectionHeader);
  if (!section) return configToml;

  const markerLine = "# " + UPSTREAM_MARKER + " = " + JSON.stringify(upstreamBaseUrl);
  const baseUrlLine = "base_url = " + JSON.stringify(proxyBaseUrl);
  const markerPattern = new RegExp("^\\s*#\\s*" + escapeRegExp(UPSTREAM_MARKER) + "\\s*=");
  const baseUrlPattern = /^\s*base_url\s*=/;
  const out = [...lines];
  for (let i = section.end - 1; i > section.start; i--) {
    if (markerPattern.test(out[i])) out.splice(i, 1);
  }
  const refreshedSection = findSectionFromLines(out, sectionHeader);
  if (!refreshedSection) return configToml;
  let baseUrlIndex = -1;
  for (let i = refreshedSection.start + 1; i < refreshedSection.end; i++) {
    if (baseUrlPattern.test(out[i])) {
      baseUrlIndex = i;
      break;
    }
  }
  if (baseUrlIndex === -1) {
    out.splice(refreshedSection.start + 1, 0, markerLine, baseUrlLine);
  } else {
    out.splice(baseUrlIndex, 1, markerLine, baseUrlLine);
  }
  return out.join("\n") + (endsWithNewline || configToml.length === 0 ? "\n" : "");
}

function findSection(
  configToml: string,
  sectionHeader: string,
): { lines: string[]; start: number; end: number } | null {
  const lines = configToml.split("\n");
  return findSectionFromLines(lines, sectionHeader);
}

function findSectionFromLines(
  lines: string[],
  sectionHeader: string,
): { lines: string[]; start: number; end: number } | null {
  const normalizedHeader = sectionHeader.trim().toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === normalizedHeader);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { lines, start, end };
}

function normalizeMaiHostname(input: string): string {
  let normalized = input.replace(/[^A-Za-z0-9._-]/g, "-");
  while (normalized.length > 0 && /^[._-]/.test(normalized)) normalized = normalized.slice(1);
  while (normalized.length > 0 && /[._-]$/.test(normalized)) normalized = normalized.slice(0, -1);
  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
    while (normalized.length > 0 && /[._-]$/.test(normalized)) normalized = normalized.slice(0, -1);
  }
  return normalized || "host";
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}
