/**
 * What `takode lease run` and `takode exec --pool` print about waiting for a
 * pool slot: a warning when a command that already holds a slot asks for
 * another (nested slots, which can deadlock), and a line now and then while a
 * wait goes on, so a long or stuck wait shows in the command's output instead
 * of looking like a quiet command.
 */

import { formatLeaseWaitDuration } from "../shared/resource-lease-message.js";

/** How often a command still waiting for a slot says so. */
export const STILL_WAITING_EVERY_MS = 5 * 60_000;

/**
 * A warning when this process runs inside a command holding a pool slot
 * (`TAKODE_LEASE_RESOURCE`, set by `lease run` and `exec --pool`) and asks for
 * a slot of `requested`, or null. Nesting is allowed, since it is often
 * harmless, but a pool whose slots are all held by outer commands waiting for
 * their inner ones never frees a slot.
 */
export function nestedPoolWarning(requested: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const held = env.TAKODE_LEASE_RESOURCE?.trim();
  if (!held) return null;
  const slot = env.TAKODE_LEASE_SLOT?.trim() ? `slot ${env.TAKODE_LEASE_SLOT.trim()} of ` : "a slot of ";
  const risk =
    poolName(held) === poolName(requested)
      ? "Nested slots of one pool can deadlock: once outer commands hold every slot, the inner commands they wait for never start."
      : `This can deadlock if other commands hold ${requested} while they wait for ${held}; take pools in the same order everywhere.`;
  return (
    `Warning: this command already runs inside ${slot}${held} and now waits for a slot of ${requested}. ${risk} ` +
    "Take a pool's slot once, in the outer or the inner command. Continuing."
  );
}

/**
 * The line a command prints while its wait goes on: how long, where it stands
 * (`note`, from the server: place in line, holders, time since a slot changed
 * hands) and, inside a held slot, that it may be waiting on itself.
 */
export function stillWaitingLine(
  waitedMs: number,
  note: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const held = env.TAKODE_LEASE_RESOURCE?.trim();
  return (
    `still waiting for a slot after ${formatLeaseWaitDuration(waitedMs)}` +
    (note ? `: ${note}` : "") +
    (held ? `. It runs inside a slot of ${held} itself, so this may be a nested-slot deadlock` : "")
  );
}

/** A pool's name without the machine: `lean@condor` and `lean` are both `lean`. */
function poolName(key: string): string {
  return key.trim().toLowerCase().split("@")[0]!;
}
