/**
 * What an idle session waits on apart from its timers, as the server reports it
 * in the session navigation projection. The sidebar, top bar, hover card, work
 * board and the feed's waiting chip all read this one list, so each wait kind
 * gets the same icon and wording everywhere.
 *
 * Only Claude sessions report background jobs; Codex does not tell Takode about
 * its background commands, so a Codex session's list never holds a job.
 */
export type SessionWait =
  /** The user's answer on a quest held in User Checkpoint. */
  | { kind: "answer"; questId: string }
  /** A background job the agent is notified about when it ends. */
  | { kind: "job"; description: string; startedAt: number }
  /** An active landing-queue run of the session's change. */
  | { kind: "landing" }
  /** A place in a resource-lease queue. */
  | { kind: "queue"; resource: string; position: number };

export type SessionWaitKind = SessionWait["kind"] | "timer";

/** Bounds that keep the list small inside the navigation projection. */
export const SESSION_WAITS_MAX_COUNT = 12;
export const SESSION_WAIT_TEXT_MAX_LENGTH = 200;

const EMPTY_WAITS: readonly SessionWait[] = [];

export function isSessionWaitList(value: unknown): value is SessionWait[] {
  return Array.isArray(value) && value.length <= SESSION_WAITS_MAX_COUNT && value.every(isSessionWait);
}

export function sessionWaitsEqual(left: readonly SessionWait[], right: readonly SessionWait[]): boolean {
  if (left === right) return true;
  return (
    left.length === right.length &&
    left.every((wait, index) => {
      const other = right[index] as Record<string, unknown>;
      return Object.entries(wait).every(([key, value]) => other[key] === value);
    })
  );
}

/** Clip a server-built list to the projection bounds. */
export function boundSessionWaits(waits: readonly SessionWait[]): SessionWait[] {
  return waits.slice(0, SESSION_WAITS_MAX_COUNT).map((wait) => {
    if (wait.kind === "job") return { ...wait, description: wait.description.slice(0, SESSION_WAIT_TEXT_MAX_LENGTH) };
    if (wait.kind === "queue") return { ...wait, resource: wait.resource.slice(0, SESSION_WAIT_TEXT_MAX_LENGTH) };
    if (wait.kind === "answer") return { ...wait, questId: wait.questId.slice(0, SESSION_WAIT_TEXT_MAX_LENGTH) };
    return wait;
  });
}

/**
 * The wait that leads every display: the first reported wait (the server lists
 * the user's answer, then background jobs, the landing run and lease queues),
 * else timers. Null when the session waits on nothing.
 */
export function primarySessionWaitKind(
  timerCount: number,
  waits: readonly SessionWait[] | null | undefined,
): SessionWaitKind | null {
  return waits?.[0]?.kind ?? (timerCount > 0 ? "timer" : null);
}

/**
 * One line naming every wait, e.g. `background job "Run full gate"; agent-browser (#2 in line)`.
 * Answers and jobs are grouped, since a session often has several. Null for an empty list.
 */
export function describeSessionWaits(waits: readonly SessionWait[] | null | undefined): string | null {
  const list = waits ?? EMPTY_WAITS;
  const parts: string[] = [];
  const questIds = list.flatMap((wait) => (wait.kind === "answer" ? [wait.questId] : []));
  if (questIds.length > 0) parts.push(`user's answer on ${questIds.join(", ")}`);
  const jobs = list.flatMap((wait) => (wait.kind === "job" ? [wait] : []));
  if (jobs.length > 0) {
    const quoted = jobs
      .map((job) => job.description.trim())
      .filter(Boolean)
      .map((text) => `"${text}"`)
      .join(", ");
    const label = jobs.length > 1 ? `${jobs.length} background jobs` : "background job";
    parts.push(quoted ? `${label}${jobs.length > 1 ? ":" : ""} ${quoted}` : label);
  }
  if (list.some((wait) => wait.kind === "landing")) parts.push("landing run");
  for (const wait of list) {
    if (wait.kind === "queue") parts.push(`${wait.resource} (#${wait.position} in line)`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function isSessionWait(value: unknown): value is SessionWait {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const wait = value as Record<string, unknown>;
  const keys = Object.keys(wait).length;
  if (wait.kind === "answer") return keys === 2 && isBoundedText(wait.questId);
  if (wait.kind === "job") {
    return keys === 3 && isBoundedText(wait.description) && isNonNegativeNumber(wait.startedAt);
  }
  if (wait.kind === "landing") return keys === 1;
  if (wait.kind === "queue") {
    return (
      keys === 3 &&
      isBoundedText(wait.resource) &&
      Number.isSafeInteger(wait.position) &&
      (wait.position as number) >= 1
    );
  }
  return false;
}

function isBoundedText(value: unknown): boolean {
  return typeof value === "string" && value.length <= SESSION_WAIT_TEXT_MAX_LENGTH;
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
