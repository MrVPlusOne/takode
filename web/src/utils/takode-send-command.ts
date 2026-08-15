import { parse } from "shell-quote";
import { stripCommandThreadComment } from "../../shared/thread-routing.js";

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*/;
const FLAG_WITH_VALUE = new Set(["--port"]);
const FLAG_WITHOUT_VALUE = new Set(["--correction", "--json"]);
const STDIN_REDIRECT_OPS = new Set(["<", "<<<"]);

type ShellToken = ReturnType<typeof parse>[number];

/**
 * Recognize one Bash invocation whose only effect is sending a Takode message.
 * This intentionally fails closed for compound commands, pipelines, wrappers,
 * and malformed input rather than guessing from a textual mention.
 */
export function isPureTakodeSendCommand(rawCommand: unknown): boolean {
  if (typeof rawCommand !== "string") return false;
  if (!/\btakode\b/.test(rawCommand) || !/\bsend\b/.test(rawCommand)) return false;

  const routedCommand = stripCommandThreadComment(rawCommand).trim();
  const heredoc = stripTerminalHeredoc(routedCommand);
  if (!heredoc) return false;
  if (/\$\(|`/.test(heredoc.command)) return false;

  let tokens: ReturnType<typeof parse>;
  try {
    tokens = parse(heredoc.command);
  } catch {
    return false;
  }

  const normalized = normalizeSimpleCommandTokens(tokens);
  if (!normalized) return false;
  const words = stripSupportedEnvironmentPrefix(normalized.words);
  if (!words || words.length < 3) return false;
  if (baseCommandName(words[0]) !== "takode" || words[1].toLowerCase() !== "send") return false;

  const target = words[2];
  if (!target || target.startsWith("-")) return false;

  let useStdin = false;
  const messageWords: string[] = [];
  for (let index = 3; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--stdin") {
      if (useStdin) return false;
      useStdin = true;
      continue;
    }
    if (FLAG_WITHOUT_VALUE.has(word)) continue;
    if (FLAG_WITH_VALUE.has(word)) {
      index += 1;
      if (!words[index] || words[index].startsWith("-")) return false;
      continue;
    }
    if (word.startsWith("-")) return false;
    messageWords.push(word);
  }

  const suppliesStdin = heredoc.suppliesStdin || normalized.suppliesStdin;
  if (useStdin) return suppliesStdin && messageWords.length === 0;
  return !suppliesStdin && messageWords.length > 0;
}

function normalizeSimpleCommandTokens(
  tokens: ReturnType<typeof parse>,
): { words: string[]; suppliesStdin: boolean } | null {
  const words: string[] = [];
  let suppliesStdin = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (typeof token === "string") {
      words.push(token);
      continue;
    }
    if (!token || typeof token !== "object" || !("op" in token)) return null;
    if (!STDIN_REDIRECT_OPS.has(token.op) || suppliesStdin) return null;
    const operand = tokens[index + 1];
    if (index + 1 !== tokens.length - 1 || typeof operand !== "string" || !operand.trim()) return null;
    suppliesStdin = true;
    index += 1;
  }

  return { words, suppliesStdin };
}

function stripSupportedEnvironmentPrefix(words: string[]): string[] | null {
  let index = 0;
  while (index < words.length && ENV_ASSIGNMENT_RE.test(words[index])) index += 1;

  if (baseCommandName(words[index] ?? "") === "env") {
    index += 1;
    while (index < words.length && ENV_ASSIGNMENT_RE.test(words[index])) index += 1;
    if (words[index] === "--") index += 1;
    if (words[index]?.startsWith("-")) return null;
  }

  return words.slice(index);
}

function baseCommandName(word: string): string {
  const normalized = word.trim().replace(/\\/g, "/");
  return (normalized.split("/").at(-1) ?? normalized).toLowerCase();
}

function stripTerminalHeredoc(command: string): { command: string; suppliesStdin: boolean } | null {
  if (!/[\r\n]/.test(command)) return { command, suppliesStdin: false };

  const normalized = command.replace(/\r\n?/g, "\n");
  const firstLineEnd = normalized.indexOf("\n");
  const header = normalized.slice(0, firstLineEnd);
  const match = /^(.*?)\s+<<(-)?\s*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\3|([A-Za-z_][A-Za-z0-9_]*))\s*$/.exec(header);
  if (!match) return null;

  const delimiter = match[4] ?? match[5];
  const delimiterIsQuoted = Boolean(match[3]);
  const stripTabs = match[2] === "-";
  const bodyLines = normalized.slice(firstLineEnd + 1).split("\n");
  while (bodyLines.at(-1) === "") bodyLines.pop();
  const terminator = bodyLines.pop();
  const normalizedTerminator = stripTabs ? terminator?.replace(/^\t+/, "") : terminator;
  if (!delimiter || normalizedTerminator !== delimiter) return null;
  const body = bodyLines.join("\n");
  if (!body.trim()) return null;
  if (!delimiterIsQuoted && /\$\(|`/.test(body)) return null;

  return { command: match[1].trim(), suppliesStdin: true };
}
