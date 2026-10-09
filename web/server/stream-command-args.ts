/**
 * Command-line parsing for `stream`, shared by the server that runs commands
 * and the CLI that sends them. Loading it touches no stream data.
 */

/** Commands that change stream data. The server runs these; the others only read. */
const WRITE_COMMANDS = new Set(["create", "update", "archive"]);

export function isStreamWriteCommand(args: readonly string[]): boolean {
  return WRITE_COMMANDS.has(args[0] ?? "");
}

/** The files a command reads from the caller's machine, by the path given on the command line. */
export function streamCommandInputFiles(args: readonly string[]): string[] {
  const parsed = parseStreamArgs(args);
  return [parsed.option("desc-file"), parsed.option("entry-file")].filter((path): path is string => !!path);
}

/** Whether the command needs a default scope, i.e. it names no `--scope`. */
export function streamCommandNeedsDefaultScope(args: readonly string[]): boolean {
  return !parseStreamArgs(args).option("scope")?.trim();
}

export interface ParsedStreamArgs {
  command: string | undefined;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
  options: (name: string) => string[];
  positional: (index: number) => string | undefined;
}

export function parseStreamArgs(input: readonly string[]): ParsedStreamArgs {
  const args = [...input];
  return {
    command: args[0],
    flag: (name) => args.includes(`--${name}`),
    option: (name) => {
      const idx = args.indexOf(`--${name}`);
      if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) return args[idx + 1];
      return undefined;
    },
    options: (name) => {
      const result: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--")) {
          result.push(args[i + 1]);
          i += 1;
        }
      }
      return result;
    },
    positional: (index) => {
      let pos = 0;
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) {
          if (args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
          continue;
        }
        if (pos === index) return args[i];
        pos += 1;
      }
      return undefined;
    },
  };
}
