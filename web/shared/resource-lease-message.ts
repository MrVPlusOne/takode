/**
 * Contract for the "[Resource lease acquired]" message injected when a queued
 * session is promoted to a lease holder. The server writes these labeled lines
 * and the feed's lease chip parses them back, so both sides share the labels.
 */
export const RESOURCE_LEASE_MESSAGE_LABELS = {
  slot: "Slot",
  purpose: "Purpose",
  acquired: "Acquired",
  waited: "Waited",
  expires: "Expires",
} as const;

export type ResourceLeaseMessageField = keyof typeof RESOURCE_LEASE_MESSAGE_LABELS;

export type ResourceLeaseMessageFields = Partial<Record<ResourceLeaseMessageField, string>>;

/** Compact wait duration for people and agents, e.g. "<1s", "45s", "3m 12s", "2h 5m". */
export function formatLeaseWaitDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

export function formatResourceLeaseMessageLine(field: ResourceLeaseMessageField, value: string | number): string {
  return `${RESOURCE_LEASE_MESSAGE_LABELS[field]}: ${value}`;
}

/** Read the labeled lines; messages from older servers lack Acquired and Waited. */
export function parseResourceLeaseMessageFields(content: string): ResourceLeaseMessageFields {
  const fields: ResourceLeaseMessageFields = {};
  for (const [field, label] of Object.entries(RESOURCE_LEASE_MESSAGE_LABELS) as Array<
    [ResourceLeaseMessageField, string]
  >) {
    const value = content.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim();
    if (value) fields[field] = value;
  }
  return fields;
}

/** The message without its labeled lines, leaving the header and the follow-up guidance. */
export function stripResourceLeaseMessageFields(content: string): string {
  const labels = new Set<string>(Object.values(RESOURCE_LEASE_MESSAGE_LABELS));
  return content
    .split("\n")
    .filter((line) => !labels.has(line.match(/^([A-Za-z]+):/)?.[1] ?? ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
