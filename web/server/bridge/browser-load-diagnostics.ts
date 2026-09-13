import {
  BROWSER_LOAD_BATCH_SIZE,
  BROWSER_LOAD_MAX_STAGES,
  BROWSER_LOAD_MESSAGE_TYPES,
  BROWSER_LOAD_STAGES,
  BROWSER_LOAD_WINDOW_MS,
  BROWSER_ENTRY_RESOURCE_FIELDS,
  BROWSER_ENTRY_RESOURCE_LIMIT,
  BROWSER_ENTRY_RESOURCE_MAX_BYTES,
  type BrowserLoadReport,
} from "../../shared/browser-load-diagnostics.js";
import { getTakodeProcessBuildId } from "../build-identity.js";
import { createLogger } from "../server-logger.js";

const logger = createLogger("browser-load");
const budgets = new WeakMap<object, { startedAt: number; count: number; entryResources?: boolean }>();
const stageKeys = new Set([
  "stage",
  "atMs",
  "view",
  "windowHash",
  "messageType",
  "receiveId",
  "parseMs",
  "applyMs",
  "loading",
  "persisted",
  "entryResources",
]);
const reportKeys = new Set([
  "documentId",
  "lifecycleId",
  "lifecycle",
  "timeOrigin",
  "startedAtMs",
  "moduleStartedAtMs",
  "hiddenMs",
  "displayMode",
  "visibility",
  "frontendBuildId",
  "navigation",
  "stages",
]);
const navigationTimes = [
  "requestStart",
  "responseStart",
  "responseEnd",
  "domInteractive",
  "domContentLoadedEventEnd",
  "loadEventEnd",
];
const navigationKeys = new Set(["type", ...navigationTimes]);

/** Validate untrusted metadata and charge a socket-owned budget before durable logging. */
export function logBrowserLoadReport(socket: object, sessionId: string, connectionId: string, report: unknown): void {
  const now = performance.now();
  const previous = budgets.get(socket);
  const budget =
    previous && now - previous.startedAt < BROWSER_LOAD_WINDOW_MS ? previous : { startedAt: now, count: 0 };
  budgets.set(socket, budget);
  if (budget.count >= BROWSER_LOAD_MAX_STAGES || !validReport(report)) return;
  if (budget.count + report.stages.length > BROWSER_LOAD_MAX_STAGES) return;
  const resourceStages = report.stages.filter((stage) => stage.stage === "entry_resources");
  if (resourceStages.length > 1 || (resourceStages.length && budget.entryResources)) return;
  if (resourceStages.length) {
    if (report.displayMode !== "standalone") return;
    const stage = resourceStages[0]!;
    if (
      stage.entryResources?.status !== "expired" &&
      (report.lifecycle !== "startup" ||
        stage.atMs < report.moduleStartedAtMs ||
        stage.atMs - report.moduleStartedAtMs > BROWSER_LOAD_WINDOW_MS)
    )
      return;
    budget.entryResources = true;
  }
  budget.count += report.stages.length;
  logger.info("Browser frontend stages", {
    sessionId,
    connectionId,
    backendBuildId: getTakodeProcessBuildId(),
    ...report,
  });
}

function record(value: unknown, keys: Set<string>): value is Record<string, unknown> {
  return (
    !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.has(key))
  );
}
function number(value: unknown, max = 365 * 24 * 60 * 60 * 1000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}
function oneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}
function matches(value: unknown, pattern: RegExp): boolean {
  return typeof value === "string" && pattern.test(value);
}
function validStage(value: unknown): boolean {
  if (!record(value, stageKeys) || !oneOf(value.stage, BROWSER_LOAD_STAGES) || !number(value.atMs)) return false;
  if (value.stage === "entry_resources") {
    if (!validEntryResources(value.entryResources)) return false;
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > BROWSER_ENTRY_RESOURCE_MAX_BYTES) return false;
  } else if (value.entryResources !== undefined) return false;
  if (value.view !== undefined && !matches(value.view, /^(main|all|history|q-\d{1,12})$/)) return false;
  if (value.windowHash !== undefined && !matches(value.windowHash, /^[a-f0-9]{1,128}$/i)) return false;
  if (value.messageType !== undefined && !oneOf(value.messageType, BROWSER_LOAD_MESSAGE_TYPES)) return false;
  if (
    value.receiveId !== undefined &&
    (!number(value.receiveId, Number.MAX_SAFE_INTEGER) || !Number.isInteger(value.receiveId))
  )
    return false;
  for (const key of ["parseMs", "applyMs"]) if (value[key] !== undefined && !number(value[key])) return false;
  for (const key of ["loading", "persisted"])
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  return true;
}
const resourceSummaryKeys = new Set(["status", "resources"]);
const resourceKeys = new Set(["role", "status", "timings"]);
const resourceTimingKeys = new Set<string>(BROWSER_ENTRY_RESOURCE_FIELDS);

function validEntryResources(value: unknown): boolean {
  if (!record(value, resourceSummaryKeys) || !Array.isArray(value.resources)) return false;
  if (oneOf(value.status, ["unsupported", "expired", "ambiguous"])) return value.resources.length === 0;
  if (
    !oneOf(value.status, ["complete", "incomplete"]) ||
    value.resources.length === 0 ||
    value.resources.length > BROWSER_ENTRY_RESOURCE_LIMIT
  )
    return false;
  for (const entry of value.resources) {
    if (!record(entry, resourceKeys) || !oneOf(entry.role, ["entry_script", "entry_stylesheet"])) return false;
    if (oneOf(entry.status, ["missing", "ambiguous"])) {
      if (entry.timings !== undefined) return false;
      continue;
    }
    if (!oneOf(entry.status, ["available", "partial"]) || !record(entry.timings, resourceTimingKeys)) return false;
    if (!Object.values(entry.timings).every((time) => number(time, Number.MAX_SAFE_INTEGER))) return false;
    if (
      entry.status === "available" &&
      (Object.keys(entry.timings).length !== BROWSER_ENTRY_RESOURCE_FIELDS.length ||
        (entry.timings.responseEnd as number) <= 0)
    )
      return false;
  }
  const complete =
    value.resources.every((entry) => entry.status === "available") &&
    value.resources.some((entry) => entry.role === "entry_script") &&
    value.resources.some((entry) => entry.role === "entry_stylesheet");
  return (value.status === "complete") === complete;
}
function validReport(value: unknown): value is BrowserLoadReport {
  if (!record(value, reportKeys)) return false;
  if (!matches(value.documentId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i))
    return false;
  if (!number(value.lifecycleId, Number.MAX_SAFE_INTEGER) || !Number.isInteger(value.lifecycleId)) return false;
  if (!oneOf(value.lifecycle, ["startup", "foreground", "connection"])) return false;
  if (!number(value.timeOrigin, 1e14) || !number(value.startedAtMs) || !number(value.moduleStartedAtMs)) return false;
  if (value.hiddenMs !== undefined && !number(value.hiddenMs)) return false;
  if (!oneOf(value.displayMode, ["standalone", "browser"]) || !oneOf(value.visibility, ["visible", "hidden"]))
    return false;
  if (value.frontendBuildId !== null && !matches(value.frontendBuildId, /^[a-zA-Z0-9._-]{1,128}$/)) return false;
  if (value.navigation !== undefined) {
    const nav = value.navigation;
    if (!record(nav, navigationKeys) || !oneOf(nav.type, ["navigate", "reload", "back_forward", "prerender"]))
      return false;
    if (!navigationTimes.every((key) => number(nav[key]))) return false;
  }
  return (
    Array.isArray(value.stages) &&
    value.stages.length > 0 &&
    value.stages.length <= BROWSER_LOAD_BATCH_SIZE &&
    value.stages.every(validStage)
  );
}
