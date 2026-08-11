import type { ThreadRef } from "./session-types.js";

export interface ActiveCodexReasoningPreview {
  text: string;
  updatedAt: number;
  turnId?: string | null;
  threadKey?: string;
  questId?: string;
  truncated?: boolean;
}

export interface CodexReasoningDetailMessage {
  type: "codex_reasoning_detail";
  id: string;
  text: string;
  status: "streaming" | "complete";
  timestamp: number;
  parent_tool_use_id: string | null;
  reasoning_turn_id?: string;
  reasoning_item_ordinal?: number;
  provider_item_id?: string;
  summary_index?: number;
  thinking_time_ms?: number;
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadRef[];
}
