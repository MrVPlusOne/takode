import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import type { SocketData } from "./ws-bridge.js";
import { machineFor } from "./remote-host/session-machine.js";
import type { TerminalProcess } from "./terminal-process.js";

interface TerminalInstance {
  id: string;
  sessionKey: string;
  cwd: string;
  /** Remote host the shell runs on; null for this machine. */
  hostId: string | null;
  process: TerminalProcess;
  browserSockets: Set<ServerWebSocket<SocketData>>;
  cols: number;
  rows: number;
  orphanTimer: ReturnType<typeof setTimeout> | null;
  outputChunks: Uint8Array[];
  outputBytes: number;
}

const GLOBAL_TERMINAL_SESSION_KEY = "__global__";
const MAX_OUTPUT_BUFFER_BYTES = 128 * 1024;

function toSessionKey(sessionId?: string | null): string {
  return sessionId?.trim() || GLOBAL_TERMINAL_SESSION_KEY;
}

function cloneChunk(data: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data);
}

export class TerminalManager {
  private instancesById = new Map<string, TerminalInstance>();
  private terminalIdBySessionKey = new Map<string, string>();

  private appendOutput(inst: TerminalInstance, data: string | ArrayBuffer | Uint8Array): Uint8Array {
    const chunk = cloneChunk(data);
    inst.outputChunks.push(chunk);
    inst.outputBytes += chunk.byteLength;
    while (inst.outputBytes > MAX_OUTPUT_BUFFER_BYTES && inst.outputChunks.length > 1) {
      const dropped = inst.outputChunks.shift();
      if (dropped) inst.outputBytes -= dropped.byteLength;
    }
    return chunk;
  }

  private getInstanceByTerminalId(terminalId: string): TerminalInstance | null {
    return this.instancesById.get(terminalId) ?? null;
  }

  private getInstanceBySessionKey(sessionKey: string): TerminalInstance | null {
    const terminalId = this.terminalIdBySessionKey.get(sessionKey);
    return terminalId ? this.getInstanceByTerminalId(terminalId) : null;
  }

  private clearOrphanTimer(inst: TerminalInstance): void {
    if (inst.orphanTimer) {
      clearTimeout(inst.orphanTimer);
      inst.orphanTimer = null;
    }
  }

  private removeInstance(inst: TerminalInstance): void {
    this.clearOrphanTimer(inst);
    this.instancesById.delete(inst.id);
    if (this.terminalIdBySessionKey.get(inst.sessionKey) === inst.id) {
      this.terminalIdBySessionKey.delete(inst.sessionKey);
    }
  }

  private cleanupExitedInstance(inst: TerminalInstance, exitCode: number): void {
    if (!this.instancesById.has(inst.id)) return;
    const exitMsg = JSON.stringify({ type: "exit", exitCode });
    for (const ws of inst.browserSockets) {
      try {
        ws.send(exitMsg);
      } catch {
        // socket may have closed
      }
    }
    this.removeInstance(inst);
  }

  /**
   * Spawn or replace the terminal associated with a session key. The shell runs
   * on the remote host `hostId` when given, otherwise on this machine.
   */
  spawn(sessionId: string | undefined, cwd: string, cols = 80, rows = 24, hostId?: string | null): string {
    const sessionKey = toSessionKey(sessionId);
    const existing = this.getInstanceBySessionKey(sessionKey);
    if (existing) {
      this.kill(sessionId);
    }

    const id = randomUUID();
    const shell = machineFor(hostId).openTerminal(cwd, cols, rows, {
      onData: (data) => {
        const inst = this.instancesById.get(id);
        if (!inst) return;
        const chunk = this.appendOutput(inst, data);
        for (const ws of inst.browserSockets) {
          try {
            ws.sendBinary(chunk);
          } catch {
            // socket may have closed
          }
        }
      },
      onExit: (exitCode) => {
        const inst = this.instancesById.get(id);
        if (!inst) return;
        console.log(`[terminal] Terminal ${id} exited with code ${exitCode}`);
        this.cleanupExitedInstance(inst, exitCode);
      },
    });

    const inst: TerminalInstance = {
      id,
      sessionKey,
      cwd,
      hostId: hostId ?? null,
      process: shell,
      browserSockets: new Set(),
      cols,
      rows,
      orphanTimer: null,
      outputChunks: [],
      outputBytes: 0,
    };
    this.instancesById.set(id, inst);
    this.terminalIdBySessionKey.set(sessionKey, id);
    console.log(
      `[terminal] Spawned terminal ${id} for ${sessionKey} in ${cwd}${hostId ? ` on host ${hostId}` : ""} (${cols}x${rows})`,
    );
    return id;
  }

  /** Handle a message from a browser WebSocket */
  handleBrowserMessage(terminalId: string, _ws: ServerWebSocket<SocketData>, msg: string | Buffer): void {
    const inst = this.getInstanceByTerminalId(terminalId);
    if (!inst) return;
    try {
      const str = typeof msg === "string" ? msg : msg.toString();
      const parsed = JSON.parse(str);
      if (parsed.type === "input" && typeof parsed.data === "string") {
        inst.process.write(parsed.data);
      } else if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
        this.resize(terminalId, parsed.cols, parsed.rows);
      }
    } catch {
      // Malformed message, ignore
    }
  }

  /** Resize the PTY */
  resize(terminalId: string, cols: number, rows: number): void {
    const inst = this.getInstanceByTerminalId(terminalId);
    if (!inst) return;
    inst.cols = cols;
    inst.rows = rows;
    inst.process.resize(cols, rows);
  }

  /** Kill the terminal process associated with a session key or the global fallback. */
  kill(sessionId?: string | null): void {
    const inst = this.getInstanceBySessionKey(toSessionKey(sessionId));
    if (!inst) return;
    this.removeInstance(inst);

    try {
      inst.process.kill("SIGTERM");
    } catch {
      // process may have already exited
    }
    // Interactive shells ignore SIGTERM.
    setTimeout(() => {
      try {
        inst.process.kill("SIGKILL");
      } catch {
        // already dead, good
      }
    }, 2_000);

    console.log(`[terminal] Killed terminal ${inst.id} for ${inst.sessionKey}`);
  }

  /** Get current terminal info for a session key or the global fallback. */
  getInfo(sessionId?: string | null): { id: string; cwd: string; hostId: string | null } | null {
    const inst = this.getInstanceBySessionKey(toSessionKey(sessionId));
    if (!inst) return null;
    return { id: inst.id, cwd: inst.cwd, hostId: inst.hostId };
  }

  /** Attach a browser WebSocket to a terminal and replay buffered output. */
  addBrowserSocket(terminalId: string, ws: ServerWebSocket<SocketData>): void {
    const inst = this.getInstanceByTerminalId(terminalId);
    if (!inst) return;

    this.clearOrphanTimer(inst);
    inst.browserSockets.add(ws);

    for (const chunk of inst.outputChunks) {
      try {
        ws.sendBinary(chunk);
      } catch {
        break;
      }
    }
  }

  /** Remove a browser WebSocket from the terminal. */
  removeBrowserSocket(terminalId: string, ws: ServerWebSocket<SocketData>): void {
    const inst = this.getInstanceByTerminalId(terminalId);
    if (!inst) return;
    inst.browserSockets.delete(ws);

    if (inst.browserSockets.size === 0) {
      inst.orphanTimer = setTimeout(() => {
        const latest = this.getInstanceByTerminalId(terminalId);
        if (latest && latest.browserSockets.size === 0) {
          console.log(`[terminal] No browsers connected, killing orphaned terminal ${terminalId}`);
          this.kill(latest.sessionKey === GLOBAL_TERMINAL_SESSION_KEY ? undefined : latest.sessionKey);
        }
      }, 60_000);
    }
  }
}
