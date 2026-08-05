import type { ChatMessage } from "../types.js";
import { parseHerdEvents } from "./herd-event-parser.js";

const ROUTINE_EVENT_TYPES = new Set(["turn_end", "worker_stream"]);

function parseHeaderEventType(header: string): string | null {
  const parts = header.split("|").map((part) => part.trim());
  return parts.length >= 2 ? parts[1] || null : null;
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
    return (
      !isError &&
      !interrupted &&
      !interruptSource &&
      !compacted &&
      !recoveryPending &&
      !provisional &&
      (!Number.isFinite(userMessageCount) || userMessageCount === 0) &&
      turnSource !== "user"
    );
  }
  if (eventType === "worker_stream") {
    const userMessageCount = Number.parseInt(parts[12] ?? "", 10);
    const turnSource = parts[14] ?? "";
    return (!Number.isFinite(userMessageCount) || userMessageCount === 0) && turnSource !== "user";
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
      message.takodeHerdEvents.every((event) => event.routine === true && ROUTINE_EVENT_TYPES.has(event.event))
    );
  }
  if (hasStructuredEventMetadata(message)) return false;
  const events = parseHerdEvents(message.content);
  return (
    events.length > 0 && events.every((event) => ROUTINE_EVENT_TYPES.has(parseHeaderEventType(event.header) ?? ""))
  );
}

export function makeWorkerEventActivityItems(messages: ChatMessage[]) {
  return messages.flatMap((message) =>
    Array.from({ length: Math.max(getHerdEventCount(message), 1) }, (_, index) => ({
      id: `${message.id}:worker-event:${index}`,
      name: "SendMessage",
      kind: "worker_event" as const,
      input: {},
      messageId: message.id,
    })),
  );
}

export function getHerdEventHeaderSummary(header: string): string {
  const parts = header.split("|").map((part) => part.trim());
  if (parts.length < 2) return header;
  const status = parts[2] ?? "";
  const firstStatusCode = status.codePointAt(0);
  const statusToken =
    firstStatusCode === 10007 || status.startsWith("!") || status.toLowerCase().includes("interrupt")
      ? ` | ${status.split(/\s+/)[0]}`
      : "";
  return `${parts[0]} | ${parts[1]}${statusToken}`;
}
