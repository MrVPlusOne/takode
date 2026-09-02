import type { ChatMessage } from "../types.js";
import {
  HERD_EVENT_LIFECYCLE_LABELS,
  HERD_EVENT_LIFECYCLE_ORDER,
  type TakodeHerdEventLifecycle,
} from "../../shared/herd-event-lifecycle.js";
import { parseHerdEvents } from "./herd-event-parser.js";

const ROUTINE_STRUCTURED_EVENT_TYPES = new Set(["turn_end", "worker_stream", "board_stalled"]);
const ROUTINE_LEGACY_TEXT_EVENT_TYPES = new Set(["turn_end", "worker_stream"]);
const DECISION_EVENT_TYPES = new Set(["permission_request", "notification_needs_input"]);
const HERD_EVENT_LIFECYCLE_LABEL_SET = new Set<string>(Object.values(HERD_EVENT_LIFECYCLE_LABELS));

function parseHeaderEventType(header: string): string | null {
  const parts = header.split("|").map((part) => part.trim());
  return parts.length >= 2 ? parts[1] || null : null;
}

function getStructuredEventKeyTypes(keys: string[] | undefined): string[] {
  return (keys ?? []).map((key) => key.split("|")[0]?.trim()).filter((eventType): eventType is string => !!eventType);
}

function getHerdEventTypes(message: ChatMessage): string[] {
  if (message.takodeHerdEvents?.length) return message.takodeHerdEvents.map((event) => event.event);
  const keyTypes = getStructuredEventKeyTypes(message.takodeHerdEventKeys);
  if (keyTypes.length > 0) return keyTypes;
  return parseHerdEvents(message.content)
    .map((event) => parseHeaderEventType(event.header))
    .filter((eventType): eventType is string => eventType !== null);
}

function isRoutineEventKey(key: string): boolean {
  const parts = key.split("|");
  const eventType = parts[0];
  if (eventType === "turn_end") {
    const isError = parts[4] === "true";
    const interrupted = parts[5] === "true";
    const interruptSource = parts[6] ?? "";
    const compacted = parts[9] === "true";
    const recoveryPending = parts[10] === "true";
    const provisional = parts[11] === "true";
    const userMessageCount = Number.parseInt(parts[21] ?? "", 10);
    const turnSource = parts[23] ?? "";
    const awaitingDecision = parts[24] === "true";
    const resumedAfterDecision = parts[25] === "true";
    return (
      !isError &&
      !interrupted &&
      !interruptSource &&
      !compacted &&
      !recoveryPending &&
      !provisional &&
      !awaitingDecision &&
      !resumedAfterDecision &&
      (!Number.isFinite(userMessageCount) || userMessageCount === 0) &&
      turnSource !== "user"
    );
  }
  if (eventType === "worker_stream") {
    const userMessageCount = Number.parseInt(parts[12] ?? "", 10);
    const turnSource = parts[14] ?? "";
    return (!Number.isFinite(userMessageCount) || userMessageCount === 0) && turnSource !== "user";
  }
  if (eventType === "board_stalled") {
    return true;
  }
  return false;
}

function hasStructuredEventMetadata(message: ChatMessage): boolean {
  return !!message.takodeHerdEvents?.length || !!message.takodeHerdEventKeys?.length;
}

export function getHerdEventCount(message: ChatMessage): number {
  if (message.takodeHerdEvents?.length) return message.takodeHerdEvents.length;
  if (message.takodeHerdEventKeys?.length) return message.takodeHerdEventKeys.length;
  return parseHerdEvents(message.content).length;
}

export function isRoutineHerdEventMessage(message: ChatMessage): boolean {
  const count = getHerdEventCount(message);
  if (count === 0) return false;
  if (message.takodeHerdEventKeys?.length) {
    return message.takodeHerdEventKeys.length === count && message.takodeHerdEventKeys.every(isRoutineEventKey);
  }
  if (message.takodeHerdEvents?.length) {
    return (
      message.takodeHerdEvents.length === count &&
      message.takodeHerdEvents.every(
        (event) => event.routine === true && ROUTINE_STRUCTURED_EVENT_TYPES.has(event.event),
      )
    );
  }
  if (hasStructuredEventMetadata(message)) return false;
  const events = parseHerdEvents(message.content);
  return (
    events.length > 0 &&
    events.every((event) => ROUTINE_LEGACY_TEXT_EVENT_TYPES.has(parseHeaderEventType(event.header) ?? ""))
  );
}

export function isCompactableHerdEventMessage(message: ChatMessage): boolean {
  const count = getHerdEventCount(message);
  if (count === 0) return false;
  const eventTypes = getHerdEventTypes(message);
  if (eventTypes.length !== count) return false;
  return eventTypes.every((eventType) => !DECISION_EVENT_TYPES.has(eventType));
}

export function makeWorkerEventActivityItems(messages: ChatMessage[]) {
  return messages.flatMap((message) => {
    const count = Math.max(getHerdEventCount(message), 1);
    return Array.from({ length: count }, (_, index) => {
      const lifecycle = message.takodeHerdEvents?.[index]?.lifecycle;
      return {
        id: `${message.id}:worker-event:${index}`,
        name: "SendMessage",
        kind: "worker_event" as const,
        input: lifecycle?.length ? { herdEventLifecycle: lifecycle } : {},
        messageId: message.id,
      };
    });
  });
}

export function getHerdEventLifecycles(message: ChatMessage): TakodeHerdEventLifecycle[] {
  return message.takodeHerdEvents?.flatMap((event) => event.lifecycle ?? []) ?? [];
}

export function summarizeWorkerEventActivity(count: number, lifecycles: readonly TakodeHerdEventLifecycle[]): string {
  const lifecycleCounts = new Map<TakodeHerdEventLifecycle, number>();
  for (const lifecycle of lifecycles) {
    lifecycleCounts.set(lifecycle, (lifecycleCounts.get(lifecycle) ?? 0) + 1);
  }
  const lifecycleLabels = HERD_EVENT_LIFECYCLE_ORDER.flatMap((lifecycle) => {
    const lifecycleCount = lifecycleCounts.get(lifecycle) ?? 0;
    if (lifecycleCount === 0) return [];
    const label = HERD_EVENT_LIFECYCLE_LABELS[lifecycle];
    return [lifecycleCount === 1 ? label : `${lifecycleCount}× ${label}`];
  });
  if (lifecycleLabels.length === 0) return `${count} worker event${count === 1 ? "" : "s"}`;
  const label = lifecycleLabels.join(", ");
  return count === 1 ? label : `${count} worker events · includes ${label}`;
}

export function getHerdEventHeaderSummary(header: string): string {
  const parts = header.split("|").map((part) => part.trim());
  if (parts.length < 2) return header;
  const lifecycleLabels = parts.slice(2).filter((part) => HERD_EVENT_LIFECYCLE_LABEL_SET.has(part));
  if (lifecycleLabels.length > 0) return `${parts[0]} | ${parts[1]} | ${lifecycleLabels.join(" | ")}`;
  const status = parts[2] ?? "";
  if (status.includes(HERD_EVENT_LIFECYCLE_LABELS.interrupted)) {
    return `${parts[0]} | ${parts[1]} | ${HERD_EVENT_LIFECYCLE_LABELS.interrupted}`;
  }
  if (status.includes(HERD_EVENT_LIFECYCLE_LABELS.failed)) {
    return `${parts[0]} | ${parts[1]} | ${HERD_EVENT_LIFECYCLE_LABELS.failed}`;
  }
  const firstStatusCode = status.codePointAt(0);
  const statusToken =
    firstStatusCode === 10007 || status.startsWith("!") || status.toLowerCase().includes("interrupt")
      ? ` | ${status.split(/\s+/)[0]}`
      : "";
  return `${parts[0]} | ${parts[1]}${statusToken}`;
}
