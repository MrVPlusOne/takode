export type CliStreamLogLevel = "info" | "warn" | "error";

export interface CodexTokenRefreshNoiseState {
  lastEmittedAt: number;
  suppressed: number;
}

export const CODEX_TOKEN_REFRESH_SUPPRESSION_MS = 60_000;

const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;

export function classifyCliStreamLogLevel(label: "stdout" | "stderr", text: string): CliStreamLogLevel {
  if (label === "stdout") return "info";
  if (isMaiCodexWrapperDiagnostic(text)) return "info";
  if (isCodexRefreshTokenReusedNoise(text)) return "warn";
  return "error";
}

export function isCodexRefreshTokenReusedNoise(text: string): boolean {
  const lines = normalizedLines(text);
  return lines.length > 0 && lines.every(isCodexRefreshTokenReusedLine);
}

function isCodexRefreshTokenReusedLine(normalized: string): boolean {
  if (!normalized.includes("codex_login::auth::manager")) return false;
  if (!normalized.includes("failed to refresh token")) return false;
  return (
    normalized.includes("refresh_token_reused") ||
    normalized.includes("refresh token was already used") ||
    normalized.includes("refresh token has already been used")
  );
}

export function maybeFormatCodexTokenRefreshLogLine(
  stateBySession: Map<string, CodexTokenRefreshNoiseState>,
  sessionId: string,
  line: string,
  now = Date.now(),
  suppressMs = CODEX_TOKEN_REFRESH_SUPPRESSION_MS,
): string | null {
  const current = stateBySession.get(sessionId);
  if (!current || now - current.lastEmittedAt >= suppressMs) {
    const prefix =
      current && current.suppressed > 0
        ? `[suppressed ${current.suppressed} repeated Codex token refresh stderr line(s)] `
        : "";
    stateBySession.set(sessionId, { lastEmittedAt: now, suppressed: 0 });
    return `${prefix}${line}`;
  }

  current.suppressed++;
  return null;
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, "");
}

function normalizedLines(text: string): string[] {
  return stripAnsi(text)
    .toLowerCase()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMaiCodexWrapperDiagnostic(text: string): boolean {
  const lines = normalizedLines(text);
  return lines.length > 0 && lines.every((line) => line.startsWith("[mai-codex-wrapper]"));
}
