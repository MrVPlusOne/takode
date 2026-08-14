import { open } from "node:fs/promises";
import { findCodexRolloutPathBounded, type CodexRolloutDiscoveryLimits } from "./codex-resume-rollout.js";

const SESSION_META_SCAN_BYTES = 64 * 1024;
const TURN_CONTEXT_SCAN_BYTES = 8 * 1024 * 1024;
const SAFE_DIAGNOSTIC_TEXT = /^[A-Za-z0-9._:-]+$/;

export type CodexEffectiveMultiAgentVersion = "disabled" | "v1" | "v2";

export type CodexRolloutDiagnosticsStatus =
  | "reported"
  | "thread_id_missing"
  | "rollout_not_found"
  | "rollout_discovery_truncated"
  | "rollout_unreadable"
  | "session_meta_missing"
  | "session_meta_mismatch"
  | "turn_context_missing"
  | "turn_context_outside_scan_window"
  | "turn_context_invalid";

export interface CodexMultiAgentRuntimeDiagnostics {
  source: "retained_rollout";
  status: CodexRolloutDiagnosticsStatus;
  sessionMetaMatched: boolean;
  cliVersion: string | null;
  turnId: string | null;
  observedAt: number | null;
  scannedBytes: number;
  scanTruncated: boolean;
}

export interface CodexRolloutRuntimeDiagnosticsResult {
  codexEffectiveMultiAgentVersion: CodexEffectiveMultiAgentVersion | null;
  codexEffectiveMultiAgentMode: string | null;
  codexEffectiveMultiAgentVersionReported: boolean;
  codexMultiAgentRuntimeDiagnostics: CodexMultiAgentRuntimeDiagnostics;
}

type RolloutRecord = {
  timestamp?: unknown;
  type?: unknown;
  payload?: Record<string, unknown>;
};

function emptyResult(
  status: Exclude<CodexRolloutDiagnosticsStatus, "reported">,
  options: Partial<Omit<CodexMultiAgentRuntimeDiagnostics, "source" | "status">> = {},
): CodexRolloutRuntimeDiagnosticsResult {
  return {
    codexEffectiveMultiAgentVersion: null,
    codexEffectiveMultiAgentMode: null,
    codexEffectiveMultiAgentVersionReported: false,
    codexMultiAgentRuntimeDiagnostics: {
      source: "retained_rollout",
      status,
      sessionMetaMatched: options.sessionMetaMatched ?? false,
      cliVersion: options.cliVersion ?? null,
      turnId: options.turnId ?? null,
      observedAt: options.observedAt ?? null,
      scannedBytes: options.scannedBytes ?? 0,
      scanTruncated: options.scanTruncated ?? false,
    },
  };
}

function parseRecord(line: string): RolloutRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as RolloutRecord;
  } catch {
    return null;
  }
}

function boundedDiagnosticText(value: unknown, maxLength = 128): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || !SAFE_DIAGNOSTIC_TEXT.test(trimmed)) return null;
  return trimmed;
}

function parseObservedAt(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function completeLines(text: string, options: { startsAtFileStart: boolean; endsAtFileEnd: boolean }): string[] {
  let body = text;
  if (!options.startsAtFileStart) {
    const firstNewline = body.indexOf("\n");
    if (firstNewline < 0) return [];
    body = body.slice(firstNewline + 1);
  }
  const lines = body.split("\n");
  if (!options.endsAtFileEnd || !body.endsWith("\n")) lines.pop();
  return lines;
}

async function readWindow(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<{ text: string; bytesRead: number }> {
  if (length <= 0) return { text: "", bytesRead: 0 };
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return { text: buffer.subarray(0, bytesRead).toString("utf8"), bytesRead };
}

function findMatchingSessionMeta(
  lines: string[],
  threadId: string,
): { matched: boolean; sawSessionMeta: boolean; cliVersion: string | null } {
  let sawSessionMeta = false;
  for (const line of lines) {
    const record = parseRecord(line);
    if (record?.type !== "session_meta" || !record.payload) continue;
    sawSessionMeta = true;
    const sessionId = boundedDiagnosticText(record.payload.session_id ?? record.payload.id);
    if (sessionId !== threadId) continue;
    return {
      matched: true,
      sawSessionMeta: true,
      cliVersion: boundedDiagnosticText(record.payload.cli_version),
    };
  }
  return { matched: false, sawSessionMeta, cliVersion: null };
}

function parseMultiAgentVersion(value: unknown): CodexEffectiveMultiAgentVersion | null {
  return value === "disabled" || value === "v1" || value === "v2" ? value : null;
}

/**
 * Read the retained Codex rollout for one thread without exposing raw rollout
 * content or performing unbounded I/O. Runtime version authority comes only
 * from a rollout whose session_meta matches the requested thread id.
 */
export async function readCodexRolloutRuntimeDiagnostics(
  codexSessionHome: string,
  threadId: string,
  options: { discoveryLimits?: CodexRolloutDiscoveryLimits } = {},
): Promise<CodexRolloutRuntimeDiagnosticsResult> {
  if (!threadId.trim()) return emptyResult("thread_id_missing");
  const discovery = await findCodexRolloutPathBounded(codexSessionHome, threadId, options.discoveryLimits).catch(
    () => ({ path: null, truncated: false }),
  );
  if (!discovery.path) {
    return emptyResult(discovery.truncated ? "rollout_discovery_truncated" : "rollout_not_found");
  }
  const rolloutPath = discovery.path;

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(rolloutPath, "r");
    const snapshot = await handle.stat();
    const fileSize = Math.max(0, snapshot.size);
    const headLength = Math.min(fileSize, SESSION_META_SCAN_BYTES);
    const head = await readWindow(handle, 0, headLength);
    const headLines = completeLines(head.text, {
      startsAtFileStart: true,
      endsAtFileEnd: head.bytesRead >= fileSize,
    });
    const sessionMeta = findMatchingSessionMeta(headLines, threadId);
    if (!sessionMeta.matched) {
      return emptyResult(sessionMeta.sawSessionMeta ? "session_meta_mismatch" : "session_meta_missing", {
        scannedBytes: head.bytesRead,
        scanTruncated: head.bytesRead < fileSize,
      });
    }

    const tailStart = Math.max(0, fileSize - TURN_CONTEXT_SCAN_BYTES);
    const tailReadStart = tailStart > 0 ? tailStart - 1 : 0;
    const tail = await readWindow(handle, tailReadStart, fileSize - tailReadStart);
    const tailLines = completeLines(tail.text, {
      startsAtFileStart: tailReadStart === 0,
      endsAtFileEnd: true,
    });
    const scannedBytes = head.bytesRead + tail.bytesRead;
    const scanTruncated = tailStart > 0;

    for (let index = tailLines.length - 1; index >= 0; index--) {
      const line = tailLines[index];
      const record = parseRecord(line);
      if (!record) {
        if (/"type"\s*:\s*"turn_context"/.test(line)) {
          return emptyResult("turn_context_invalid", {
            sessionMetaMatched: true,
            cliVersion: sessionMeta.cliVersion,
            scannedBytes,
            scanTruncated,
          });
        }
        continue;
      }
      if (record.type !== "turn_context") continue;
      if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
        return emptyResult("turn_context_invalid", {
          sessionMetaMatched: true,
          cliVersion: sessionMeta.cliVersion,
          scannedBytes,
          scanTruncated,
        });
      }
      const version = parseMultiAgentVersion(record.payload.multi_agent_version);
      const turnId = boundedDiagnosticText(record.payload.turn_id);
      const observedAt = parseObservedAt(record.timestamp);
      if (!version || !turnId) {
        return emptyResult("turn_context_invalid", {
          sessionMetaMatched: true,
          cliVersion: sessionMeta.cliVersion,
          turnId,
          observedAt,
          scannedBytes,
          scanTruncated,
        });
      }
      return {
        codexEffectiveMultiAgentVersion: version,
        codexEffectiveMultiAgentMode: boundedDiagnosticText(record.payload.multi_agent_mode),
        codexEffectiveMultiAgentVersionReported: true,
        codexMultiAgentRuntimeDiagnostics: {
          source: "retained_rollout",
          status: "reported",
          sessionMetaMatched: true,
          cliVersion: sessionMeta.cliVersion,
          turnId,
          observedAt,
          scannedBytes,
          scanTruncated,
        },
      };
    }

    return emptyResult(scanTruncated ? "turn_context_outside_scan_window" : "turn_context_missing", {
      sessionMetaMatched: true,
      cliVersion: sessionMeta.cliVersion,
      scannedBytes,
      scanTruncated,
    });
  } catch {
    return emptyResult("rollout_unreadable");
  } finally {
    await handle?.close().catch(() => {});
  }
}
