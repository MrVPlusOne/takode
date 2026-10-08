import { accessSync, constants, existsSync, statSync } from "node:fs";

/** A login shell running in a pseudo-terminal, on this machine or on a remote host. */
export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Signal the shell; does nothing once it has exited. */
  kill(signal: NodeJS.Signals): void;
}

/** Where a terminal's output and exit go. */
export interface TerminalOutput {
  onData(chunk: Uint8Array): void;
  /** Called once, when the shell exits. */
  onExit(code: number): void;
}

/** Bun's PTY handle on a process spawned with the `terminal` option. */
interface BunTerminalHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/**
 * Start this machine's login shell in a pseudo-terminal. The coordinator uses
 * it for its own terminals and `takode node` for terminals on its host.
 */
export function spawnLocalTerminal(cwd: string, cols: number, rows: number, output: TerminalOutput): TerminalProcess {
  // Bun (1.3.10) crashes the whole process, instead of throwing, when a PTY
  // spawn fails, e.g. in a folder that no longer exists.
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("not a folder"); // sync-ok: cold path, once per terminal spawn
    accessSync(cwd, constants.X_OK); // sync-ok: cold path, once per terminal spawn
  } catch {
    throw new Error(`Cannot open a terminal in ${cwd}: the folder does not exist or is not accessible`);
  }
  let exited = false;
  const finish = (code: number) => {
    if (exited) return;
    exited = true;
    output.onExit(code);
  };
  const proc = Bun.spawn([resolveShell(), "-l"], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color", CLAUDECODE: undefined },
    terminal: {
      cols,
      rows,
      data: (_terminal, data) => {
        if (!exited) output.onData(data);
      },
    },
  });
  // Not the PTY's own exit callback: it fires before the exit code is known.
  void proc.exited.then((code) => finish(code ?? 0));
  const terminal = (proc as unknown as { terminal: BunTerminalHandle }).terminal;
  return {
    write: (data) => terminal.write(data),
    resize: (newCols, newRows) => {
      try {
        terminal.resize(newCols, newRows);
      } catch {
        // resize not available or failed
      }
    },
    kill: (signal) => {
      // After exit the pid may belong to another process.
      if (!exited) proc.kill(signal);
    },
  };
}

function resolveShell(): string {
  if (process.env.SHELL && existsSync(process.env.SHELL)) return process.env.SHELL; // sync-ok: cold path, once per terminal spawn
  if (existsSync("/bin/bash")) return "/bin/bash"; // sync-ok: cold path, once per terminal spawn
  return "/bin/sh";
}
