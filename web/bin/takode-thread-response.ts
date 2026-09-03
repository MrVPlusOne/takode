import { createHash } from "node:crypto";
import {
  assertKnownFlags,
  err,
  formatInlineText,
  getCallerSessionId,
  parseFlags,
  readOptionTextFile,
  takodeAuthHeaders,
} from "./takode-core.js";

export const THREAD_RESPONSE_HELP = `Usage: takode thread-response show --thread <main|q-N> [--history] [--json]
       takode thread-response set --thread <main|q-N> --text-file <path|-> [--json]

Show pending user-request batches and current leader responses for one explicit thread, or publish the next response.
Set automatically creates a response for the oldest server-owned pending batch; when none is pending, it revises the latest response.
The command itself is the user-visible routed response, so do not repeat the same prose in a normal assistant message.
`;

interface ThreadResponsePendingPreview {
  preview: string;
  truncated: boolean;
  imageCount: number;
  timestamp: number;
}

interface ThreadResponsePendingBatch {
  token: string;
  messageCount: number;
  firstAskedAt: number;
  lastAskedAt: number;
  previews: ThreadResponsePendingPreview[];
}

interface ThreadResponseRevision {
  revisionId: string;
  parentRevisionId?: string;
  revisionNumber: number;
  messageId: string;
  historyIndex: number;
  markdown: string;
  contentHash: string;
  createdAt: number;
  idempotencyKey?: string;
}

interface LeaderThreadResponse {
  version: 1;
  logicalResponseId: string;
  threadKey: string;
  questId?: string;
  batchId: string;
  currentRevisionId: string;
  currentMessageId: string;
  currentHistoryIndex: number;
  revisionCount: number;
  coveredMessageCount: number;
  createdAt: number;
  updatedAt: number;
  revisions: ThreadResponseRevision[];
}

interface LeaderThreadResponseState {
  version: 1;
  cutoverHistoryIndex: number;
  pendingMessageCount: number;
  pendingBatches: ThreadResponsePendingBatch[];
  responses: LeaderThreadResponse[];
  ready: boolean;
}

interface ThreadResponseStateResponse {
  sessionId: string;
  threadKey: string;
  responseState: LeaderThreadResponseState;
}

interface ThreadResponseMutationResponse extends ThreadResponseStateResponse {
  response: LeaderThreadResponse;
}

type ThreadResponseIntent =
  | { intent: "create"; pendingBatchToken: string; baseRevisionId: null }
  | { intent: "revise"; responseId: string; baseRevisionId: string };

function normalizeThreadKey(value: string | boolean | undefined): string {
  if (typeof value !== "string" || !value.trim()) err("--thread requires main or q-N.");
  const normalized = value.trim().toLowerCase();
  if (normalized !== "main" && !/^q-\d+$/.test(normalized)) err("--thread requires main or q-N.");
  return normalized;
}

function commandPositionals(args: string[], valueFlags: ReadonlySet<string>): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positionals.push(arg);
  }
  return positionals;
}

function responsePath(sessionId: string, threadKey: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/thread-responses/${encodeURIComponent(threadKey)}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function fetchResponseState(
  base: string,
  sessionId: string,
  threadKey: string,
): Promise<ThreadResponseStateResponse> {
  const response = await fetch(`${base}${responsePath(sessionId, threadKey)}`, {
    headers: takodeAuthHeaders(),
  });
  const body = await readJson(response);
  if (!response.ok)
    throw new Error((body.error as string | undefined) || `Thread response request failed (${response.status})`);
  return body as unknown as ThreadResponseStateResponse;
}

async function publishResponse(
  base: string,
  sessionId: string,
  threadKey: string,
  body: ThreadResponseIntent & { markdown: string; idempotencyKey: string },
): Promise<ThreadResponseMutationResponse> {
  const response = await fetch(`${base}${responsePath(sessionId, threadKey)}`, {
    method: "PUT",
    headers: takodeAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const state = payload.responseState as LeaderThreadResponseState | undefined;
    const pending = state ? ` Pending messages now: ${state.pendingMessageCount}.` : "";
    const current =
      response.status === 409 && payload.currentRevisionId !== undefined
        ? ` Current revision: ${(payload.currentRevisionId as string | null) ?? "none"}.`
        : "";
    const retry = response.status === 409 ? " Rerun set so Takode can use the latest server-owned response state." : "";
    throw new Error(
      `${(payload.error as string | undefined) || `Thread response update failed (${response.status})`}${current}${pending}${retry}`,
    );
  }
  return payload as unknown as ThreadResponseMutationResponse;
}

function currentRevision(response: LeaderThreadResponse): ThreadResponseRevision | null {
  return response.revisions.find((revision) => revision.revisionId === response.currentRevisionId) ?? null;
}

function oneLinePreview(markdown: string, maxLength = 240): string {
  const compact = markdown.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatThreadLabel(threadKey: string): string {
  return threadKey === "main" ? "Main" : threadKey;
}

function formatTime(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "unknown time";
}

function compactState(state: LeaderThreadResponseState): unknown {
  return {
    version: state.version,
    pendingMessageCount: state.pendingMessageCount,
    pendingBatches: state.pendingBatches.map((batch) => ({
      messageCount: batch.messageCount,
      firstAskedAt: batch.firstAskedAt,
      lastAskedAt: batch.lastAskedAt,
      previews: batch.previews,
    })),
    responses: state.responses.map((response) => ({
      version: response.version,
      threadKey: response.threadKey,
      ...(response.questId ? { questId: response.questId } : {}),
      revisionCount: response.revisionCount,
      coveredMessageCount: response.coveredMessageCount,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      preview: oneLinePreview(currentRevision(response)?.markdown ?? ""),
    })),
    ready: state.ready,
  };
}

function compactMutation(result: ThreadResponseMutationResponse, intent: ThreadResponseIntent["intent"]): unknown {
  return {
    operation: intent,
    sessionId: result.sessionId,
    threadKey: result.threadKey,
    response: {
      version: result.response.version,
      threadKey: result.response.threadKey,
      ...(result.response.questId ? { questId: result.response.questId } : {}),
      revisionCount: result.response.revisionCount,
      coveredMessageCount: result.response.coveredMessageCount,
      createdAt: result.response.createdAt,
      updatedAt: result.response.updatedAt,
      preview: oneLinePreview(currentRevision(result.response)?.markdown ?? ""),
    },
    responseState: compactState(result.responseState),
  };
}

function printCompactState(threadKey: string, state: LeaderThreadResponseState): void {
  console.log(`${formatThreadLabel(threadKey)} thread responses`);
  console.log(
    `Pending: ${state.pendingMessageCount} message${state.pendingMessageCount === 1 ? "" : "s"} in ${state.pendingBatches.length} batch${state.pendingBatches.length === 1 ? "" : "es"}`,
  );
  state.pendingBatches.forEach((batch, index) => {
    const range =
      batch.firstAskedAt === batch.lastAskedAt
        ? formatTime(batch.firstAskedAt)
        : `${formatTime(batch.firstAskedAt)} – ${formatTime(batch.lastAskedAt)}`;
    console.log(`  Batch ${index + 1}: ${batch.messageCount} message${batch.messageCount === 1 ? "" : "s"} · ${range}`);
    for (const preview of batch.previews) {
      const images =
        preview.imageCount > 0 ? ` · ${preview.imageCount} image${preview.imageCount === 1 ? "" : "s"}` : "";
      console.log(`    - ${oneLinePreview(preview.preview, 180)}${preview.truncated ? "…" : ""}${images}`);
    }
  });

  console.log(`Current responses: ${state.responses.length}`);
  state.responses.forEach((response, index) => {
    const revision = currentRevision(response);
    console.log(
      `  Response ${index + 1}: ${response.coveredMessageCount} message${response.coveredMessageCount === 1 ? "" : "s"} · revision ${response.revisionCount} · updated ${formatTime(response.updatedAt)}`,
    );
    if (revision) console.log(`    ${oneLinePreview(revision.markdown)}`);
  });
  console.log(`Ready: ${state.ready ? "yes" : "no"}`);
}

function printHistory(state: LeaderThreadResponseState): void {
  console.log("");
  console.log(`Audit: cutover history ${state.cutoverHistoryIndex}`);
  state.pendingBatches.forEach((batch, index) => {
    console.log(`Pending batch ${index + 1}: ${batch.token}`);
  });
  state.responses.forEach((response, responseIndex) => {
    console.log("");
    console.log(
      `Response ${responseIndex + 1}: ${response.logicalResponseId} · batch ${response.batchId} · ${response.revisionCount} revision${response.revisionCount === 1 ? "" : "s"}`,
    );
    for (const revision of response.revisions) {
      console.log("");
      console.log(
        `Revision ${revision.revisionNumber}/${response.revisionCount} · ${revision.revisionId} · message ${revision.messageId} · history ${revision.historyIndex} · ${formatTime(revision.createdAt)}`,
      );
      console.log(revision.markdown);
    }
  });
}

function chooseIntent(state: LeaderThreadResponseState): ThreadResponseIntent {
  const pending = state.pendingBatches[0];
  if (pending) {
    return { intent: "create", pendingBatchToken: pending.token, baseRevisionId: null };
  }
  const latest = state.responses.at(-1);
  if (!latest) {
    err("This thread has no pending user messages and no prior leader response to revise.");
  }
  return {
    intent: "revise",
    responseId: latest.logicalResponseId,
    baseRevisionId: latest.currentRevisionId,
  };
}

function stableIdempotencyKey(input: {
  sessionId: string;
  threadKey: string;
  operation: ThreadResponseIntent;
  markdown: string;
}): string {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return `thread-response-cli:${digest}`;
}

export async function handleThreadResponse(base: string, args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "show" && subcommand !== "set") err(THREAD_RESPONSE_HELP.trim());

  const optionArgs = args.slice(1);
  const flags = parseFlags(optionArgs);
  const allowed =
    subcommand === "show" ? new Set(["thread", "history", "json"]) : new Set(["thread", "text-file", "json"]);
  assertKnownFlags(flags, allowed, THREAD_RESPONSE_HELP.trim());

  const positionals = commandPositionals(optionArgs, new Set(["--thread", "--text-file"]));
  if (positionals.length > 0) {
    err(`${THREAD_RESPONSE_HELP.trim()}\n\nDo not pass response Markdown positionally. Use --text-file <path|->.`);
  }

  const threadKey = normalizeThreadKey(flags.thread);
  const sessionId = getCallerSessionId();

  if (subcommand === "show") {
    if (flags.history !== undefined && flags.history !== true) err("--history does not take a value.");
    const result = await fetchResponseState(base, sessionId, threadKey);
    if (flags.json === true) {
      console.log(
        JSON.stringify(
          flags.history === true
            ? result
            : {
                sessionId: result.sessionId,
                threadKey: result.threadKey,
                responseState: compactState(result.responseState),
              },
          null,
          2,
        ),
      );
      return;
    }
    printCompactState(result.threadKey, result.responseState);
    if (flags.history === true) printHistory(result.responseState);
    return;
  }

  const textFile = flags["text-file"];
  if (textFile === undefined) err(`${THREAD_RESPONSE_HELP.trim()}\n\n--text-file is required.`);
  if (textFile === true) err("--text-file requires a path or '-' for stdin.");
  const markdown = await readOptionTextFile(textFile, "--text-file");
  if (!markdown.trim()) err("Thread response Markdown is required.");

  const observed = await fetchResponseState(base, sessionId, threadKey);
  const operation = chooseIntent(observed.responseState);
  const result = await publishResponse(base, sessionId, threadKey, {
    ...operation,
    markdown,
    idempotencyKey: stableIdempotencyKey({ sessionId, threadKey, operation, markdown }),
  });

  if (flags.json === true) {
    console.log(JSON.stringify(compactMutation(result, operation.intent), null, 2));
    return;
  }

  const action = operation.intent === "create" ? "Created" : "Revised";
  const remaining = result.responseState.pendingMessageCount;
  console.log(
    `✓ ${action} ${formatInlineText(formatThreadLabel(result.threadKey))} response for ${result.response.coveredMessageCount} message${result.response.coveredMessageCount === 1 ? "" : "s"} (revision ${result.response.revisionCount}); ${remaining} pending`,
  );
}
