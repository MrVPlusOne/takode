import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { QuestmasterTask } from "../server/quest-types.js";
import { QUEST_TLDR_WARNING_HEADER, tldrWarningForContent } from "../server/quest-tldr.js";
import { questCommandPositionals } from "../shared/quest-command-classification.js";

type FeedbackEditDeps = {
  companionPort?: string;
  companionAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  editLocally?: (
    questId: string,
    index: number,
    patch: { text?: string; tldr?: string },
  ) => Promise<QuestmasterTask | null>;
};

const args = process.argv.slice(2);

let stdinTextPromise: Promise<string> | null = null;
let stdinFlagName: string | null = null;

export async function runFeedbackEditCommand(deps: FeedbackEditDeps): Promise<void> {
  validateFlags(["text", "text-file", "tldr", "tldr-file", "json"]);
  const id = positional(1);
  const indexStr = positional(2);
  if (!id || indexStr === undefined) {
    die(
      'Usage: quest feedback edit <questId> <index> (--text "..." | --text-file <path>|-) ' +
        '[--tldr "..." | --tldr-file <path>|-] [--json]',
    );
  }
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) die("Index must be a non-negative integer");

  const text = await readOptionalRichTextOption({
    inlineFlag: "text",
    fileFlag: "text-file",
    label: "Feedback text",
  });
  const tldr = await readOptionalRichTextOption({
    inlineFlag: "tldr",
    fileFlag: "tldr-file",
    label: "Feedback TLDR",
    allowEmpty: true,
  });
  const hasTldrEdit = flag("tldr") || flag("tldr-file");
  if (text === undefined && !hasTldrEdit) {
    die("Feedback edit requires --text/--text-file or --tldr/--tldr-file.");
  }

  const patch = {
    ...(text !== undefined ? { text: text.trim() } : {}),
    ...(hasTldrEdit ? { tldr: tldr ?? "" } : {}),
  };
  if (deps.editLocally) {
    const quest = await deps.editLocally(id, index, patch);
    if (!quest) die(`Quest ${id} not found`);
    printResult(quest, index, null);
    return;
  }

  const port = deps.companionPort;
  if (!port) die("Companion server port not found. Set COMPANION_PORT env var.");

  try {
    const res = await fetch(`http://localhost:${port}/api/quests/${encodeURIComponent(id)}/feedback/${index}`, {
      method: "PATCH",
      headers: deps.companionAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      die((err as { error: string }).error || res.statusText);
    }
    const quest = (await res.json()) as QuestmasterTask;
    printResult(quest, index, res.headers.get(QUEST_TLDR_WARNING_HEADER));
  } catch (e) {
    die((e as Error).message);
  }
}

function printResult(quest: QuestmasterTask, index: number, headerWarning: string | null): void {
  if (flag("json")) out(quest);
  else console.log(`Edited feedback #${index} on ${quest.questId}`);
  warnAll(feedbackEditTldrWarnings(quest, index, headerWarning));
}

function feedbackEditTldrWarnings(quest: QuestmasterTask, index: number, headerWarning: string | null): string[] {
  if (headerWarning) return [headerWarning];
  const editedEntry = "feedback" in quest ? quest.feedback?.[index] : undefined;
  if (editedEntry?.author !== "agent") return [];
  const warning = tldrWarningForContent("feedback", editedEntry.text, editedEntry.tldr);
  return warning ? [warning] : [];
}

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

function positional(index: number): string | undefined {
  return questCommandPositionals(args)[index];
}

function validateFlags(allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (allowedSet.has(name)) continue;
    die(`Unknown flag: --${name}`);
  }
}

async function readOptionalRichTextOption(args: {
  inlineFlag: string;
  fileFlag: string;
  label: string;
  allowEmpty?: boolean;
}): Promise<string | undefined> {
  const inlineValue = option(args.inlineFlag);
  const fileValue = option(args.fileFlag);
  const hasInlineFlag = flag(args.inlineFlag);
  const hasFileFlag = flag(args.fileFlag);

  if (hasInlineFlag && inlineValue === undefined) die(`--${args.inlineFlag} requires a value`);
  if (hasFileFlag && fileValue === undefined) die(`--${args.fileFlag} requires a path or '-' for stdin`);
  if (inlineValue !== undefined && fileValue !== undefined) {
    die(`Use either --${args.inlineFlag} or --${args.fileFlag}, not both`);
  }

  const value =
    fileValue !== undefined
      ? await readOptionTextFile(fileValue, `--${args.fileFlag}`)
      : inlineValue !== undefined
        ? inlineValue
        : undefined;

  if (value !== undefined && !args.allowEmpty && !value.trim()) die(`${args.label} is required`);
  return value;
}

async function readOptionTextFile(pathOrDash: string, flagName: string): Promise<string> {
  if (pathOrDash === "-") {
    if (stdinFlagName && stdinFlagName !== flagName) {
      die(
        `Only one option can read from stdin per command. Already using ${stdinFlagName}; cannot also use ${flagName}.`,
      );
    }
    stdinFlagName = flagName;
    return readStdinText();
  }

  try {
    return await readFile(resolve(pathOrDash), "utf-8");
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    die(`Cannot read ${flagName} input from ${pathOrDash}${detail}`);
  }
}

async function readStdinText(): Promise<string> {
  if (!stdinTextPromise) {
    process.stdin.setEncoding("utf8");
    stdinTextPromise = (async () => {
      let text = "";
      for await (const chunk of process.stdin) text += chunk;
      return text;
    })();
  }
  return stdinTextPromise;
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function warnAll(messages: string[]): void {
  for (const message of messages) console.error(`Warning: ${message}`);
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}
