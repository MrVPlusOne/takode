import {
  BROWSER_LOAD_BATCH_SIZE,
  BROWSER_LOAD_MAX_STAGES,
  BROWSER_LOAD_MESSAGE_TYPES,
  BROWSER_LOAD_STAGES,
  BROWSER_LOAD_WINDOW_MS,
  type BrowserLoadReport,
} from "../../shared/browser-load-diagnostics.js";
import { getTakodeProcessBuildId } from "../build-identity.js";
import { createLogger } from "../server-logger.js";

const logger = createLogger("browser-load");
const budgets = new WeakMap<object, { startedAt: number; count: number }>();
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
