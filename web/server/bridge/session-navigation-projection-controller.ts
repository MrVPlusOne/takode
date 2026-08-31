import { type SessionNavigationStatus } from "../../shared/session-navigation-projection.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";

const NAVIGATION_ACTIVITY_BUCKET_MS = 1_000;

function launcherActivityValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function launcherActivityBucket(value: number | undefined): number | null {
  return value === undefined ? null : Math.floor(value / NAVIGATION_ACTIVITY_BUCKET_MS);
}

/** Resolve current server lifecycle ahead of potentially stale producer status. */
export function resolveSessionNavigationStatus(
  session: Session,
  current: SessionNavigationStatus,
): SessionNavigationStatus {
  if (current !== null && current !== "idle") return current;
  return session.navigationProducerStatus === undefined ? current : session.navigationProducerStatus;
}

/** Sample launcher activity once, then retain the exact value until a later publish bucket. */
export function getSessionNavigationLastActivityAt(
  session: Session | undefined,
  launcherValue: unknown,
): number | undefined {
  if (!session || session.navigationActivityBucket !== undefined) return session?.navigationLastActivityAt;
  const value = launcherActivityValue(launcherValue);
  session.navigationActivityBucket = launcherActivityBucket(value);
  session.navigationLastActivityAt = value;
  return value;
}

/** Publish launcher activity at most once per bucket while preserving its exact sampled timestamp. */
export function captureSessionNavigationLauncherActivity(session: Session, launcherValue: unknown): boolean {
  const value = launcherActivityValue(launcherValue);
  const bucket = launcherActivityBucket(value);
  if (session.navigationActivityBucket === bucket) return false;
  const changed = session.navigationLastActivityAt !== value;
  session.navigationActivityBucket = bucket;
  session.navigationLastActivityAt = value;
  return changed;
}

/** Capture producer-only state and report whether the projection depends on the message. */
export function captureSessionNavigationSourceMessage(session: Session, msg: BrowserIncomingMessage): boolean {
  if (msg.type === "status_change") session.navigationProducerStatus = msg.status;
  else if (msg.type === "backend_connected" || msg.type === "backend_disconnected") {
    session.navigationProducerStatus = undefined;
  }

  return (
    msg.type === "status_change" ||
    msg.type === "session_update" ||
    msg.type === "session_quest_claimed" ||
    msg.type === "timer_update" ||
    msg.type === "backend_connected" ||
    msg.type === "backend_disconnected" ||
    msg.type === "user_message" ||
    msg.type === "codex_pending_inputs" ||
    msg.type === "result" ||
    msg.type === "permission_request" ||
    msg.type === "permission_approved" ||
    msg.type === "permission_denied" ||
    msg.type === "permission_cancelled" ||
    msg.type === "permissions_cleared"
  );
}
