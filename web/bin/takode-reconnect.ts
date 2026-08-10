import { apiPost, assertKnownFlags, err, formatInlineText, formatTime, parseFlags } from "./takode-core.js";

export type ReconnectWorkersResponse = {
  ok: boolean;
  all: boolean;
  requested: number;
  started: number;
  skipped: number;
  failed: number;
  results: Array<{
    ref: string;
    sessionId?: string;
    sessionNum?: number;
    name?: string;
    status: "started" | "skipped" | "failed";
    reason: string;
    detail?: string;
  }>;
};

function reconnectResultLabel(result: ReconnectWorkersResponse["results"][number]): string {
  if (typeof result.sessionNum === "number") {
    return result.name ? `#${result.sessionNum} ${result.name}` : `#${result.sessionNum}`;
  }
  return result.name || result.sessionId || result.ref;
}

function reconnectReasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

export async function handleReconnect(base: string, args: string[]): Promise<void> {
  const usage = "Usage: takode reconnect <session1,session2,...> [--json]\\n       takode reconnect --all [--json]";
  const flags = parseFlags(args);
  assertKnownFlags(flags, new Set(["json", "all"]), usage);
  const jsonMode = flags.json === true;
  const reconnectAll = flags.all === true;
  const refs = args
    .filter((arg) => !arg.startsWith("--"))
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (reconnectAll === refs.length > 0) err(usage);

  const result = (await apiPost(base, "/takode/reconnect", {
    ...(reconnectAll ? { all: true } : { workerIds: refs }),
  })) as ReconnectWorkersResponse;

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const item of result.results) {
    const label = formatInlineText(reconnectResultLabel(item));
    if (item.status === "started") {
      console.log(`[${formatTime(Date.now())}] ↻ Reconnect started for ${label}`);
    } else if (item.status === "skipped") {
      console.log(`[${formatTime(Date.now())}] – Skipped ${label}: ${reconnectReasonLabel(item.reason)}`);
    } else {
      console.log(
        `[${formatTime(Date.now())}] ✗ Reconnect failed for ${label}: ${item.detail || reconnectReasonLabel(item.reason)}`,
      );
    }
  }
  console.log(`Reconnect results: ${result.started} started, ${result.skipped} skipped, ${result.failed} failed.`);
}
