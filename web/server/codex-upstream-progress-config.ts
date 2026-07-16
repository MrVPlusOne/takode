import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodexUpstreamProgressProxyRegistry } from "./codex-upstream-progress-proxy.js";

const MAI_LITELLM_PROVIDER = "mai-litellm";
const UPSTREAM_MARKER = "takode-copilot-progress-upstream-base-url";
const PROXY_PATH_MARKER = "/api/codex-upstream-progress-proxy/";

export async function ensureCodexUpstreamProgressProxyConfig(
  codexHome: string,
  options: {
    sessionId: string;
    registry: CodexUpstreamProgressProxyRegistry;
    containerized?: boolean;
  },
): Promise<{ enabled: boolean; changed: boolean; upstreamBaseUrl?: string; proxyBaseUrl?: string }> {
  const configPath = join(codexHome, "config.toml");
  const current = await readFile(configPath, "utf-8").catch(() => "");
  if (readTopLevelStringSetting(current, "model_provider")?.trim().toLowerCase() !== MAI_LITELLM_PROVIDER) {
    return { enabled: false, changed: false };
  }

  const sectionHeader = "[model_providers." + MAI_LITELLM_PROVIDER + "]";
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
  return { enabled: true, changed: next !== current, upstreamBaseUrl, proxyBaseUrl };
}

function isTakodeProxyUrl(value: string): boolean {
  return value.includes(PROXY_PATH_MARKER);
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}
