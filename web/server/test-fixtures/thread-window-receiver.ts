import { applyKeyedListDelta } from "../../shared/keyed-list-delta.js";
import { threadWindowEntryId } from "../../shared/thread-window.js";
import type { BrowserIncomingMessage, ThreadWindowEntry } from "../session-types.js";

type ThreadWindowSync = Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>;

/**
 * Receives `thread_window_sync` messages as a browser does: it keeps every
 * window it got by hash and builds windows sent as changes or cache hits from
 * them, so tests can read each delivery as the whole window the browser ends with.
 */
export function createThreadWindowReceiver() {
  const held = new Map<string, ThreadWindowEntry[]>();
  return {
    /** The message with its entries replaced by the whole window; throws when the browser could not build it. */
    receive(message: ThreadWindowSync): ThreadWindowSync {
      const hash = message.window.window_hash!;
      let entries: ThreadWindowEntry[] | null | undefined = message.entries;
      if (message.cache_hit) entries = held.get(hash);
      else if (message.entries_delta) {
        const base = held.get(message.entries_delta.base);
        entries =
          base &&
          applyKeyedListDelta(
            base,
            {
              upserts: message.entries,
              removed: message.entries_delta.removed,
              order: message.entries_delta.order,
            },
            threadWindowEntryId,
          );
      }
      if (!entries) throw new Error(`The browser holds no window to build ${hash} from`);
      held.set(hash, entries);
      const { entries_delta: _delta, cache_hit: _hit, ...rest } = message;
      return { ...rest, entries };
    },
  };
}
