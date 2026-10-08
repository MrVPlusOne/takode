/**
 * Wire protocol between a Takode coordinator and the `takode node` helper on a
 * remote host. The host dials out to the coordinator over one WebSocket and runs
 * that host's session processes; the coordinator keeps the adapters and all
 * shared state.
 *
 * Both directions are reliable across link drops:
 * - Commands (coordinator to host) carry a per-host sequence number. The host
 *   applies each command once, acknowledges the highest one it applied, and the
 *   coordinator resends unacknowledged commands after a reconnect.
 * - Process events (host to coordinator) carry a per-process sequence number.
 *   The host keeps events until the coordinator acknowledges them and replays
 *   the rest after a reconnect, so output produced while the link was down is
 *   delivered in order exactly once.
 *
 * Neither side survives the other's restart: a new host instance has lost its
 * processes, and a new coordinator instance has lost the adapters reading them.
 * The `instanceId` in `hello` and `welcome` lets each side detect that and
 * settle the affected processes instead of guessing.
 */

export const HOST_PROTOCOL_VERSION = 1;

/** Path the host connects to, with `Authorization: Bearer <host token>`. */
export const HOST_LINK_PATH = "/ws/host";

/** A host is reported offline when no message arrives for this long. */
export const HOST_LINK_STALE_MS = 30_000;

/** Interval at which each side sends a heartbeat. */
export const HOST_HEARTBEAT_MS = 10_000;

export type HostCommand =
  | {
      kind: "spawn";
      procId: string;
      command: string;
      args: string[];
      cwd?: string;
      /** Session-specific variables; the host merges them over its own environment. */
      env: Record<string, string>;
      /**
       * Start a launch the host prepared itself (`prepare_codex`) instead of
       * `command`/`args`/`cwd`, which are then ignored.
       */
      preparedLaunchId?: string;
    }
  /**
   * Write a file on the host, in order with the other commands, e.g. an image
   * attachment that a later stdin message refers to. `data` is base64.
   */
  | { kind: "write_file"; path: string; data: string }
  | { kind: "stdin"; procId: string; data: string }
  | { kind: "stdin_end"; procId: string }
  | { kind: "kill"; procId: string; signal: string };

export type HostProcessEvent =
  | { kind: "spawned"; pid?: number }
  | { kind: "stdout"; data: string }
  | { kind: "stderr"; data: string }
  | { kind: "exit"; code: number | null; signal: string | null }
  | { kind: "error"; message: string };

/**
 * One-shot operations the coordinator asks a host to perform on its machine,
 * such as Git queries for a session's diff or reading a file for a preview.
 * Unlike process commands they are not replayed: if the link drops first, the
 * coordinator reports the host as unavailable and the caller may retry.
 */
export type HostRequest =
  | {
      kind: "exec";
      /** Shell command, run with `/bin/sh -c`. */
      command: string;
      cwd: string;
      timeoutMs: number;
      maxOutputBytes: number;
    }
  | { kind: "read_file"; path: string; maxBytes: number }
  | { kind: "stat"; path: string }
  /** `data` is base64; missing parent directories are created. */
  | { kind: "write_file"; path: string; data: string; mode?: number }
  /**
   * Prepare a Codex launch with the host's own Codex installation, home and
   * configuration. `info` and `options` are the coordinator's launch inputs
   * (see `prepareCodexSpawn`); the host keeps the resulting command and returns
   * an id for a later `spawn` plus the settings the coordinator's adapter needs.
   */
  | { kind: "prepare_codex"; sessionId: string; info: unknown; options: unknown }
  /**
   * Run one of the named operations a session's machine performs on its own
   * repos and files (see `host-operations.ts`), with JSON arguments.
   */
  | { kind: "operation"; name: string; args: unknown[] };

export type HostResponse =
  | { kind: "exec"; code: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean }
  /** `data` is base64. */
  | { kind: "read_file"; data: string; truncated: boolean }
  | { kind: "stat"; stat: { size: number; isFile: boolean; isDirectory: boolean; mtimeMs: number } | null }
  | { kind: "write_file" }
  | { kind: "prepare_codex"; launchId: string; adapterSettings: Record<string, unknown> }
  | { kind: "operation"; result: unknown };

export type HostToCoordinator =
  | {
      t: "hello";
      protocol: number;
      /** Changes every time the `takode node` process starts. */
      instanceId: string;
      /** Highest command sequence this host instance has applied from `appliedFrom`. */
      appliedCommandSeq: number;
      /** Coordinator instance whose numbering `appliedCommandSeq` uses; null before the first welcome. */
      appliedFrom: string | null;
      /** Build of the `takode node` code, for diagnostics. */
      build?: string;
      /** The host user's home directory, for host paths the coordinator writes (attachments). */
      homeDir?: string;
    }
  | { t: "event"; procId: string; seq: number; event: HostProcessEvent }
  | { t: "command_ack"; seq: number }
  | { t: "response"; id: string; ok: true; response: HostResponse }
  | { t: "response"; id: string; ok: false; error: string }
  /** `network`: whether this host has a usable network interface (see `network-availability.ts`). */
  | { t: "heartbeat"; network?: boolean };

export type CoordinatorToHost =
  | {
      t: "welcome";
      /** Changes every time the coordinator starts. */
      instanceId: string;
      /** Highest event sequence the coordinator has received, per process it still tracks. */
      received: Record<string, number>;
    }
  | { t: "command"; seq: number; command: HostCommand }
  | { t: "event_ack"; procId: string; seq: number }
  | { t: "request"; id: string; request: HostRequest }
  | { t: "heartbeat" }
  | { t: "rejected"; reason: string };
