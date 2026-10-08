import {
  MEMORY_CATALOG_SOURCE_ID,
  MEMORY_CATALOG_SOURCE_LABEL,
  MEMORY_CATALOG_TITLE,
  MEMORY_CATALOG_TRUNCATED_PREFIX,
  MEMORY_CATALOG_UNAVAILABLE_PREFIX,
} from "../shared/injected-event-message.js";
import type { ProgrammaticHistoryFollowUp } from "./session-types.js";

export const MEMORY_CATALOG_INJECTION_CHAR_LIMIT = 100_000;

export interface MemoryCatalogInjectionBundle {
  content: string;
  agentSource: { sessionId: string; sessionLabel: string };
  truncated: boolean;
  unavailable: boolean;
  /** Persist the exact delivered catalog as this session's freshness watermark. */
  recordSeen?: () => Promise<void>;
}

export function memoryCatalogAgentSource(): MemoryCatalogInjectionBundle["agentSource"] {
  return {
    sessionId: MEMORY_CATALOG_SOURCE_ID,
    sessionLabel: MEMORY_CATALOG_SOURCE_LABEL,
  };
}

export function buildAvailableMemoryCatalogBundle(
  catalogText: string,
  options: { limit?: number } = {},
): MemoryCatalogInjectionBundle {
  const limit = normalizeLimit(options.limit);
  const guidance = renderMemoryCatalogGuidance();
  const fullContent = [MEMORY_CATALOG_TITLE, "", guidance, "", catalogText.trimEnd()].join("\n").trimEnd();
  if (fullContent.length <= limit) {
    return {
      content: fullContent,
      agentSource: memoryCatalogAgentSource(),
      truncated: false,
      unavailable: false,
    };
  }

  const warning = [
    MEMORY_CATALOG_TRUNCATED_PREFIX +
      " the catalog hit Takode's " +
      limit.toLocaleString() +
      " character injected-context limit.",
    "The preloaded content is truncated and does not advance catalog freshness. Run `memory catalog show` for full orientation or `memory catalog diff` for changes since the last complete catalog. Read relevant notes with `memory read <path>` before relying on memory facts.",
  ].join("\n");
  const prefix = [MEMORY_CATALOG_TITLE, "", warning, "", guidance, ""].join("\n");
  const suffix = "\n\n[Memory catalog output truncated.]";
  const available = Math.max(0, limit - prefix.length - suffix.length);
  return {
    content: (prefix + catalogText.slice(0, available) + suffix).slice(0, limit),
    agentSource: memoryCatalogAgentSource(),
    truncated: true,
    unavailable: false,
  };
}

export function buildUnavailableMemoryCatalogBundle(
  error: unknown,
  options: { limit?: number } = {},
): MemoryCatalogInjectionBundle {
  const message = error instanceof Error ? error.message : String(error);
  const content = [
    MEMORY_CATALOG_TITLE,
    "",
    MEMORY_CATALOG_UNAVAILABLE_PREFIX +
      " Takode could not auto-inject the catalog (" +
      (message || "unknown error") +
      ").",
    "This does not block startup or recovery. Takode attempted to create a `memory catalog show` snapshot but could not provide one. If durable memory may affect the task, run `memory catalog show` manually, use `memory catalog diff` for later freshness checks, and read relevant notes with `memory read <path>` before relying on memory facts.",
  ]
    .join("\n")
    .trimEnd()
    .slice(0, normalizeLimit(options.limit));
  return {
    content,
    agentSource: memoryCatalogAgentSource(),
    truncated: false,
    unavailable: true,
  };
}

export function buildMemoryCatalogDeliveryContent(
  primaryMessage: string,
  bundle: MemoryCatalogInjectionBundle | null | undefined,
): string {
  if (!bundle) return primaryMessage;
  return [
    primaryMessage,
    "The following memory catalog is a `memory catalog show` snapshot captured at startup/recovery injection time. Use it for orientation only; for freshness, use `memory catalog diff` or read the notes themselves with `memory read <path>` before relying on memory facts.",
    bundle.content,
  ].join("\n\n");
}

export function buildMemoryCatalogHistoryFollowUp(
  bundle: MemoryCatalogInjectionBundle | null | undefined,
): ProgrammaticHistoryFollowUp[] {
  if (!bundle) return [];
  return [
    {
      content: bundle.content,
      agentSource: bundle.agentSource,
    },
  ];
}

/** Record freshness only after the catalog has been accepted for delivery. */
export function recordMemoryCatalogSeenAfterDelivery(bundle: MemoryCatalogInjectionBundle | null | undefined): void {
  if (!bundle || bundle.unavailable || bundle.truncated) return;
  try {
    const recording = bundle.recordSeen?.();
    void recording?.catch((error) => {
      console.warn(
        `[memory-catalog] Failed to record delivered catalog freshness: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  } catch (error) {
    console.warn(
      `[memory-catalog] Failed to start delivered catalog freshness recording: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function appendMemoryCatalogToUserMessage<T extends { content: string } & Record<string, unknown>>(
  message: T,
  bundle: MemoryCatalogInjectionBundle,
): T {
  const existingDelivery = typeof message.deliveryContent === "string" ? message.deliveryContent : message.content;
  const existingFollowUps = Array.isArray(message.historyFollowUps)
    ? (message.historyFollowUps as ProgrammaticHistoryFollowUp[])
    : [];
  return {
    ...message,
    deliveryContent: buildMemoryCatalogDeliveryContent(existingDelivery, bundle),
    historyFollowUps: [...existingFollowUps, ...buildMemoryCatalogHistoryFollowUp(bundle)],
  };
}

export function hasMemoryCatalogHistoryFollowUp(message: {
  historyFollowUps?: ProgrammaticHistoryFollowUp[];
}): boolean {
  return (
    message.historyFollowUps?.some((followUp) => followUp.agentSource?.sessionId === MEMORY_CATALOG_SOURCE_ID) === true
  );
}

function renderMemoryCatalogGuidance(): string {
  return [
    "This automatically injected catalog is the result of `memory catalog show` at injection time: recently updated notes plus one line per topic folder. Treat it as an orientation snapshot, not the source of truth.",
    "Before relying on memory for a task, list every folder that matches it with `memory catalog show <folder> --seen <handle>`, passing the newest memory handle (this catalog ends with one). Use `memory catalog diff` for later changes, and read notes with `memory read <path>`.",
  ].join("\n");
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit === "number" && Number.isInteger(limit) && limit > 0) return limit;
  return MEMORY_CATALOG_INJECTION_CHAR_LIMIT;
}
