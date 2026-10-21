import type { LeaderThreadReminderProjection } from "../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../store.js";
import {
  resolveLeaderThreadTabsProjection,
  type LeaderThreadTabsProjectionSource,
} from "./leader-thread-tabs-resolver.js";
import { normalizeThreadKey } from "./thread-projection.js";

/** The thread's pending reminder, from its leader's tab projection. */
export function useThreadReminder(
  sessionId: string | undefined,
  threadKey: string | undefined,
): LeaderThreadReminderProjection | undefined {
  return useStore((state) =>
    sessionId && threadKey ? threadReminders(state, sessionId)[normalizeThreadKey(threadKey)] : undefined,
  );
}

const NO_REMINDERS: Readonly<Record<string, LeaderThreadReminderProjection>> = {};

export function threadReminders(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): Readonly<Record<string, LeaderThreadReminderProjection>> {
  return resolveLeaderThreadTabsProjection(source, sessionId).value?.threadReminders ?? NO_REMINDERS;
}
