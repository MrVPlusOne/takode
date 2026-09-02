import { randomUUID } from "node:crypto";
import type { QuestOutcomeResponse, QuestOutcomeState, QuestmasterTask } from "../server/quest-types.js";

interface QuestOutcomeCommandDeps {
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
  option: (name: string) => string | undefined;
  flag: (name: string) => boolean;
  readOptionalRichTextOption: (args: {
    inlineFlag: string;
    fileFlag: string;
    label: string;
    allowEmpty?: boolean;
  }) => Promise<string | undefined>;
  getQuest: (questId: string) => Promise<QuestmasterTask | null>;
  companionPort?: string;
  companionAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  jsonOutput: boolean;
  out: (value: unknown) => void;
  die: (message: string) => never;
}

function currentRevision(outcome: QuestOutcomeState | undefined) {
  return outcome?.revisions.find((revision) => revision.revisionId === outcome.currentRevisionId) ?? null;
}

async function responseJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Quest Outcome request failed (${response.status})`);
  return body;
}

async function fetchOutcome(deps: QuestOutcomeCommandDeps, questId: string) {
  if (!deps.companionPort) deps.die("Quest Outcome mutations require a running Companion server.");
  const response = await fetch(
    `http://localhost:${deps.companionPort}/api/quests/${encodeURIComponent(questId)}/outcome`,
    { headers: deps.companionAuthHeaders() },
  );
  return (await responseJson(response)) as { questId: string; outcome: QuestOutcomeState | null };
}

async function updateOutcome(
  deps: QuestOutcomeCommandDeps,
  questId: string,
  body: Record<string, unknown>,
): Promise<QuestOutcomeResponse> {
  if (!deps.companionPort) deps.die("Quest Outcome mutations require a running Companion server.");
  const response = await fetch(
    `http://localhost:${deps.companionPort}/api/quests/${encodeURIComponent(questId)}/outcome`,
    {
      method: "PUT",
      headers: deps.companionAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    },
  );
  return (await responseJson(response)) as QuestOutcomeResponse;
}

function printOutcome(deps: QuestOutcomeCommandDeps, questId: string, outcome: QuestOutcomeState | null | undefined) {
  if (deps.jsonOutput) {
    deps.out({ questId, outcome: outcome ?? null });
    return;
  }
  const revision = currentRevision(outcome ?? undefined);
  if (!outcome || !revision) {
    console.log(`${questId} has no Current Outcome.`);
    return;
  }
  const index = outcome.revisions.findIndex((candidate) => candidate.revisionId === revision.revisionId);
  console.log(`${questId} Current Outcome (version ${index + 1}/${outcome.revisions.length}, ${revision.revisionId})`);
  console.log(`Summary: ${revision.summaryMarkdown}`);
  if (revision.anchor) {
    console.log(`Boundary: ${revision.anchor.sessionId} history ${revision.anchor.historyIndex}`);
  }
  console.log("");
  console.log(revision.markdown);
}

export async function runQuestOutcomeCommand(deps: QuestOutcomeCommandDeps): Promise<void> {
  const subcommand = deps.positional(0);
  const questId = deps.positional(1);
  if (!subcommand || !questId || !["show", "set", "use"].includes(subcommand)) {
    deps.die(
      "Usage: quest outcome show <id> | outcome set <id> --text-file <path> | outcome use <id> --session <leader> --message <id> [--append]",
    );
  }

  if (subcommand === "show") {
    deps.validateFlags(["json"]);
    const quest = await deps.getQuest(questId);
    if (!quest) deps.die(`Quest ${questId} not found`);
    printOutcome(deps, questId, quest.outcome);
    return;
  }

  const current = await fetchOutcome(deps, questId);
  const baseRevisionId = deps.option("base") ?? current.outcome?.currentRevisionId ?? null;
  if (subcommand === "set") {
    deps.validateFlags(["text", "text-file", "summary", "summary-file", "base", "advance-through", "json"]);
    const markdown = await deps.readOptionalRichTextOption({
      inlineFlag: "text",
      fileFlag: "text-file",
      label: "Quest Outcome Markdown",
    });
    if (markdown === undefined) deps.die("Quest Outcome Markdown is required. Use --text or --text-file.");
    const summaryMarkdown = await deps.readOptionalRichTextOption({
      inlineFlag: "summary",
      fileFlag: "summary-file",
      label: "Quest Outcome summary",
    });
    const result = await updateOutcome(deps, questId, {
      baseRevisionId,
      markdown,
      ...(summaryMarkdown !== undefined ? { summaryMarkdown } : {}),
      ...(deps.option("advance-through") ? { advanceThroughSessionId: deps.option("advance-through") } : {}),
      idempotencyKey: `set:${questId}:${randomUUID()}`,
    });
    printOutcome(deps, questId, result.outcome);
    return;
  }

  deps.validateFlags(["session", "message", "history-index", "append", "base", "json"]);
  const sessionId = deps.option("session")?.trim();
  const messageId = deps.option("message")?.trim();
  if (!sessionId || !messageId) deps.die("quest outcome use requires --session <leader> and --message <id>.");
  const rawHistoryIndex = deps.option("history-index");
  const historyIndex = rawHistoryIndex === undefined ? undefined : Number.parseInt(rawHistoryIndex, 10);
  if (rawHistoryIndex !== undefined && (!Number.isInteger(historyIndex) || historyIndex! < 0)) {
    deps.die("--history-index must be a non-negative integer.");
  }
  const mode = deps.flag("append") ? "append" : "replace";
  const result = await updateOutcome(deps, questId, {
    baseRevisionId,
    mode,
    source: { sessionId, messageId, ...(historyIndex !== undefined ? { historyIndex } : {}) },
    idempotencyKey: `${mode}:${questId}:${sessionId}:${messageId}:${baseRevisionId ?? "empty"}`,
  });
  printOutcome(deps, questId, result.outcome);
}
