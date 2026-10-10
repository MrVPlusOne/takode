/**
 * A browser keeps one socket as it moves between sessions: it sends
 * `session_switch` instead of opening a new connection, which costs several
 * round trips on a slow link. This orders each socket's messages around those
 * switches: a switch waits for the work already started for the previous
 * session, so none of it reaches the socket after the switch, and a message
 * waits for the switches that arrived before it, so it is handled for the
 * session it was sent to.
 */
export class BrowserSocketSessionSwitches {
  private readonly latestSwitch = new WeakMap<object, Promise<void>>();
  private readonly inflight = new WeakMap<object, Set<Promise<unknown>>>();

  async handle(
    socket: object,
    raw: string,
    handlers: { switchTo: (sessionId: string | null) => void; handle: () => Promise<void> },
  ): Promise<void> {
    const before = this.latestSwitch.get(socket);
    const target = parseSessionSwitch(raw);
    if (target !== undefined) {
      const switching = (async () => {
        if (before) await before;
        await Promise.allSettled([...(this.inflight.get(socket) ?? [])]);
        handlers.switchTo(target);
      })();
      this.latestSwitch.set(socket, switching);
      try {
        await switching;
      } finally {
        if (this.latestSwitch.get(socket) === switching) this.latestSwitch.delete(socket);
      }
      return;
    }

    if (before) await before;
    const work = handlers.handle();
    let inflight = this.inflight.get(socket);
    if (!inflight) {
      inflight = new Set();
      this.inflight.set(socket, inflight);
    }
    inflight.add(work);
    try {
      await work;
    } finally {
      inflight.delete(work);
    }
  }
}

/** The target of a `session_switch` message, or undefined for any other message. */
function parseSessionSwitch(raw: string): string | null | undefined {
  // The browser writes `type` first; checking the prefix keeps every other message from being parsed twice.
  if (raw.length > 512 || !raw.startsWith('{"type":"session_switch"')) return undefined;
  try {
    const target = (JSON.parse(raw) as { session_id?: unknown }).session_id;
    if (target === null) return null;
    return typeof target === "string" && target.length > 0 ? target : undefined;
  } catch {
    return undefined;
  }
}
