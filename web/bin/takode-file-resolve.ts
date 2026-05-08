import { stat } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { fetchSessionInfo, formatInlineText, type TakodeSessionInfo } from "./takode-core.js";

export const FILE_RESOLVE_HELP = `Usage: takode file-resolve --session <session> [--json] <path-or-file-link>...

Resolve paths or Takode file links against a session's filesystem context.

Examples:
  takode file-resolve --session 1656 artifacts/preview.png
  takode file-resolve --session 1656 file:artifacts/preview.png '[preview](file:artifacts/preview.png)'
`;

export type FileResolveCliArgs = {
  sessionRef: string;
  jsonMode: boolean;
  inputs: string[];
};

export type FileResolveResult = {
  input: string;
  path: string;
};

export type FileResolveFailure = {
  input: string;
  error: string;
};

export async function handleFileResolve(base: string, args: string[]): Promise<void> {
  const parsed = parseFileResolveArgs(args);
  const session = await fetchSessionInfo(base, parsed.sessionRef);
  const root = await getSessionFilesystemRoot(session, parsed.sessionRef);
  const resolved = await resolveSessionFileInputs(root, parsed.inputs);

  if (resolved.errors.length > 0) {
    printFileResolveErrors(parsed.sessionRef, resolved.errors);
  }

  if (parsed.jsonMode) {
    console.log(
      JSON.stringify(
        {
          session: parsed.sessionRef,
          root,
          results: resolved.results,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const result of resolved.results) {
    console.log(result.path);
  }
}

export function parseFileResolveArgs(args: string[]): FileResolveCliArgs {
  let sessionRef = "";
  let jsonMode = false;
  const inputs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      inputs.push(...args.slice(i + 1));
      break;
    }
    if (arg === "--json") {
      jsonMode = true;
      continue;
    }
    if (arg === "--session") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        failFileResolveUsage("--session requires a session number or id.");
      }
      sessionRef = value;
      i++;
      continue;
    }
    if (arg.startsWith("--session=")) {
      const value = arg.slice("--session=".length).trim();
      if (!value) failFileResolveUsage("--session requires a session number or id.");
      sessionRef = value;
      continue;
    }
    if (arg.startsWith("--")) {
      failFileResolveUsage(`Unknown option: ${arg}`);
    }
    inputs.push(arg);
  }

  if (!sessionRef) failFileResolveUsage("--session is required.");
  if (inputs.length === 0) failFileResolveUsage("At least one path or file link is required.");
  return { sessionRef, jsonMode, inputs };
}

export async function getSessionFilesystemRoot(session: TakodeSessionInfo, sessionRef: string): Promise<string> {
  const cwd = typeof session.cwd === "string" ? session.cwd.trim() : "";
  if (!cwd || !isAbsolute(cwd)) {
    failFileResolve(`Session ${sessionRef} has no usable filesystem context: missing absolute cwd.`);
  }

  const root = normalize(cwd);
  let rootStats: Awaited<ReturnType<typeof stat>>;
  try {
    rootStats = await stat(root);
  } catch {
    failFileResolve(`Session ${sessionRef} filesystem root is not available: ${root}`);
  }
  if (!rootStats.isDirectory()) {
    failFileResolve(`Session ${sessionRef} filesystem root is not a directory: ${root}`);
  }
  return root;
}

export async function resolveSessionFileInputs(
  root: string,
  inputs: string[],
): Promise<{ results: FileResolveResult[]; errors: FileResolveFailure[] }> {
  const results: FileResolveResult[] = [];
  const errors: FileResolveFailure[] = [];

  for (const input of inputs) {
    const normalized = normalizeFileResolveInput(input);
    if (!normalized) {
      errors.push({ input, error: "Input is empty." });
      continue;
    }

    const absolutePath = resolveInputPath(root, normalized);
    if (!absolutePath) {
      errors.push({ input, error: "Relative path escapes the session filesystem context." });
      continue;
    }

    const existingPath = await findExistingPath(absolutePath);
    if (!existingPath) {
      errors.push({ input, error: `File does not exist: ${absolutePath}` });
      continue;
    }
    results.push({ input, path: existingPath });
  }

  return { results, errors };
}

export function normalizeFileResolveInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const markdownFileLink = trimmed.match(/^\[[^\]]*]\((file:[^)]+)\)$/);
  const linkOrPath = markdownFileLink ? markdownFileLink[1] : stripAngleBrackets(trimmed);
  const pathText = linkOrPath.startsWith("file:") ? linkOrPath.slice("file:".length).trim() : linkOrPath;
  return pathText ? pathText : null;
}

function failFileResolveUsage(message: string): never {
  failFileResolve(`${message}\n${FILE_RESOLVE_HELP.trim()}`);
}

function failFileResolve(message: string): never {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function printFileResolveErrors(sessionRef: string, errors: FileResolveFailure[]): never {
  const count = errors.length;
  console.error(
    JSON.stringify({
      error: `Could not resolve ${count} input${count === 1 ? "" : "s"}.`,
      session: sessionRef,
      errors: errors.map((item) => ({
        input: formatInlineText(item.input),
        error: formatInlineText(item.error),
      })),
    }),
  );
  process.exit(1);
}

function stripAngleBrackets(input: string): string {
  return input.startsWith("<") && input.endsWith(">") ? input.slice(1, -1).trim() : input;
}

function resolveInputPath(root: string, inputPath: string): string | null {
  if (isAbsolute(inputPath)) return normalize(inputPath);

  const resolved = resolve(root, inputPath);
  return isWithinOrEqual(root, resolved) ? resolved : null;
}

function isWithinOrEqual(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function findExistingPath(path: string): Promise<string | null> {
  if (await pathExists(path)) return path;

  const withoutLocation = stripTakodeLocationSuffix(path);
  if (withoutLocation !== path && (await pathExists(withoutLocation))) {
    return withoutLocation;
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function stripTakodeLocationSuffix(path: string): string {
  return path.replace(/:(?:\d+(?::\d+)?|\d+-\d+)$/, "");
}
