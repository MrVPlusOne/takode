import { readFile } from "node:fs/promises";
import { apiGet, apiPost, err, formatInlineText } from "./takode-core.js";

type GoalResponse = {
  ok?: boolean;
  goal?: {
    objective: string;
    status: string;
    tokenBudget?: number | null;
    tokensUsed?: number;
    timeUsedSeconds?: number;
  } | null;
  capability?: { state: string; error?: string | null };
  error?: string;
};

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) err(`${name} requires a value.`);
  return value;
}

async function readTextFile(path: string): Promise<string> {
  if (path === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path, "utf8");
}

function parseBudget(args: string[]): number | null | undefined {
  if (args.includes("--clear-budget")) return null;
  const raw = flagValue(args, "--budget");
  if (raw === undefined) return undefined;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) err("--budget must be a positive number.");
  return Math.floor(numeric);
}

function printGoal(sessionRef: string, response: GoalResponse, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (!response.ok && response.error) err(response.error);
  const capability = response.capability?.state;
  if (!response.goal) {
    const suffix = capability && capability !== "supported" ? ` (${capability})` : "";
    console.log(`Codex Goal for ${formatInlineText(sessionRef)}: none${suffix}`);
    return;
  }
  const goal = response.goal;
  const budget = goal.tokenBudget ? ` / ${goal.tokenBudget}` : "";
  const used = goal.tokensUsed ?? 0;
  console.log(`Codex Goal for ${formatInlineText(sessionRef)}: ${goal.status}, ${used}${budget} tokens`);
  console.log(goal.objective);
}

export async function handleGoal(base: string, args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const positional = args.filter((arg, idx) => {
    if (arg === "--json" || arg === "--replace" || arg === "--clear-budget") return false;
    if (["--text-file", "--budget"].includes(args[idx - 1])) return false;
    return !arg.startsWith("--");
  });
  const sessionRef = positional[0];
  const action = positional[1] ?? "show";
  if (!sessionRef) err("Usage: takode goal <session> show|refresh|set|pause|resume|clear [--json]");

  if (action === "show") {
    printGoal(
      sessionRef,
      (await apiGet(base, `/sessions/${encodeURIComponent(sessionRef)}/codex-goal`)) as GoalResponse,
      jsonMode,
    );
    return;
  }
  if (action === "refresh") {
    printGoal(
      sessionRef,
      (await apiPost(base, `/sessions/${encodeURIComponent(sessionRef)}/codex-goal/refresh`, {})) as GoalResponse,
      jsonMode,
    );
    return;
  }
  if (action === "pause" || action === "resume" || action === "clear") {
    printGoal(
      sessionRef,
      (await apiPost(base, `/sessions/${encodeURIComponent(sessionRef)}/codex-goal/${action}`, {})) as GoalResponse,
      jsonMode,
    );
    return;
  }
  if (action !== "set") err("Usage: takode goal <session> show|refresh|set|pause|resume|clear [--json]");

  const textFile = flagValue(args, "--text-file");
  if (!textFile) err("Usage: takode goal <session> set --text-file <path|-> [--budget <tokens>] [--replace] [--json]");
  const objective = (await readTextFile(textFile)).trim();
  if (!objective) err("Codex Goal objective cannot be empty.");
  const tokenBudget = parseBudget(args);
  printGoal(
    sessionRef,
    (await apiPost(base, `/sessions/${encodeURIComponent(sessionRef)}/codex-goal/set`, {
      objective,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      mode: args.includes("--replace") ? "replace" : "edit",
    })) as GoalResponse,
    jsonMode,
  );
}
