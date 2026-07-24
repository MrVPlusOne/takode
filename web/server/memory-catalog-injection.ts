import {
  MEMORY_CATALOG_SOURCE_ID,
  MEMORY_CATALOG_SOURCE_LABEL,
  MEMORY_CATALOG_TITLE,
  MEMORY_CATALOG_TRUNCATED_PREFIX,
  MEMORY_CATALOG_UNAVAILABLE_PREFIX,
} from "../shared/injected-event-message.js";
import type { ProgrammaticHistoryFollowUp } from "./session-types.js";
import type { MemoryCatalog, MemoryRepoOptions } from "./workstream-memory-types.js";

export const MEMORY_CATALOG_INJECTION_CHAR_LIMIT = 100_000;
const DEFAULT_CATALOG_TIMEOUT_MS = 3_000;

export interface MemoryCatalogInjectionBundle {
  content: string;
  agentSource: { sessionId: string; sessionLabel: string };
  truncated: boolean;
  unavailable: boolean;
}

export interface MemoryCatalogInjectionBuildOptions {
  repoOptions?: MemoryRepoOptions;
  sessionId?: string;
  limit?: number;
  timeoutMs?: number;
  catalog?: (options?: MemoryRepoOptions) => Promise<MemoryCatalog>;
  markCatalogSeen?: (catalog: MemoryCatalog, options?: MemoryRepoOptions) => Promise<void>;
}

export function memoryCatalogAgentSource(): MemoryCatalogInjectionBundle["agentSource"] {
  return {
    sessionId: MEMORY_CATALOG_SOURCE_ID,
    sessionLabel: MEMORY_CATALOG_SOURCE_LABEL,
  };
}

export async function buildMemoryCatalogInjectionBundle(
  options: MemoryCatalogInjectionBuildOptions = {},
): Promise<MemoryCatalogInjectionBundle> {
  const limit = normalizeLimit(options.limit);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const repoOptions = {
    ...(options.repoOptions ?? {}),
    ...(options.sessionId ? { catalogSessionKey: options.sessionId } : {}),
  };
  const catalogFn =
    options.catalog ??
    (async (input?: MemoryRepoOptions) => {
      const { workstreamMemoryService } = await import("./workstream-memory-service.js");
      return workstreamMemoryService.catalog(input);
    });
  const markSeen =
    options.markCatalogSeen ??
    (async (catalog, input) => {
      const { workstreamMemoryService } = await import("./workstream-memory-service.js");
      return workstreamMemoryService.markCatalogSeen(catalog, input);
    });

  try {
    const catalog = await withTimeout(catalogFn(repoOptions), timeoutMs);
    await withTimeout(markSeen(catalog, repoOptions), timeoutMs);
    return buildAvailableMemoryCatalogBundle(renderMemoryCatalogShow(catalog), { limit });
  } catch (error) {
    return buildUnavailableMemoryCatalogBundle(error, { limit });
  }
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
    "The preloaded content is truncated. If you need the full current catalog, run `memory catalog show`; for freshness since this injection, use `memory catalog diff`. Inspect relevant Markdown files directly before relying on memory facts.",
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
    "This does not block startup or recovery. Takode attempted to create a `memory catalog show` snapshot but could not provide one. If durable memory may affect the task, run `memory catalog show` manually, use `memory catalog diff` for later freshness checks, and inspect relevant Markdown files directly before relying on memory facts.",
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
    "The following memory catalog is a `memory catalog show` snapshot captured at startup/recovery injection time. Use it for orientation only; for freshness, use `memory catalog diff` or inspect actual memory Markdown files directly before relying on memory facts.",
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

export function renderMemoryCatalogShow(catalog: MemoryCatalog): string {
  const lines = ["Memory repo: " + catalog.repo.root];
  if (!catalog.entries.length) {
    lines.push("No memory files found.");
  }
  for (const entry of catalog.entries) {
    lines.push(entry.id + ": " + entry.description);
  }
  const issues = catalog.issues.filter((issue) => !isSafelyIgnoredObsoleteFrontmatterWarning(issue));
  if (issues.length) {
    lines.push("", "Issues:");
    for (const issue of issues) {
      const path = issue.path ? issue.path + ": " : "";
      lines.push("  " + issue.severity + ": " + path + issue.message);
    }
  }
  return lines.join("\n");
}

function renderMemoryCatalogGuidance(): string {
  return [
    "This automatically injected catalog is the result of `memory catalog show` at injection time. Treat it as an orientation snapshot, not the source of truth.",
    "For freshness after injection, prefer `memory catalog diff` or inspect the actual Markdown files directly with normal tools such as `memory repo path`, `sed`, `rg`, and `cat` instead of reflexively rerunning `memory catalog show`.",
  ].join("\n");
}

function isSafelyIgnoredObsoleteFrontmatterWarning(issue: { severity: string; message: string }): boolean {
  return (
    issue.severity === "warning" &&
    issue.message.startsWith("Obsolete memory frontmatter field ") &&
    issue.message.includes(" is ignored; derive it from path or use description/source.")
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit === "number" && Number.isInteger(limit) && limit > 0) return limit;
  return MEMORY_CATALOG_INJECTION_CHAR_LIMIT;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs === "number" && Number.isInteger(timeoutMs) && timeoutMs > 0) return timeoutMs;
  return DEFAULT_CATALOG_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("memory catalog generation timed out after " + timeoutMs + "ms")),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
