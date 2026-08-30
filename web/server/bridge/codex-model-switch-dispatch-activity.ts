import type { CodexModelSwitchCompactionGuard } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import { markCodexModelSwitchActivity } from "./codex-model-switch-compaction.js";

type CodexDispatchActivitySessionLike = {
  id: string;
  codexModelSwitchCompactionGuard?: CodexModelSwitchCompactionGuard | null;
};

export function recordCodexAcceptedDispatchActivity<T extends CodexDispatchActivitySessionLike>(
  session: T,
  persistSession: (session: T) => void,
  kind: "turn" | "steer",
  reason: string,
  count: number,
): void {
  if (markCodexModelSwitchActivity(session)) {
    persistSession(session);
  }
  if (kind === "turn") {
    console.log(
      `[ws-bridge] Dispatched queued Codex turn for session ${sessionTag(session.id)} (${reason}, attempt ${count})`,
    );
  } else {
    console.log(
      `[ws-bridge] Steered ${count} pending Codex input(s) for session ${sessionTag(session.id)} (${reason})`,
    );
  }
}
