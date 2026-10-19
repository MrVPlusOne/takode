import type { ConversationAnnotation } from "../shared/conversation-annotations.js";

export interface HistoryWindowState {
  from_turn: number;
  turn_count: number;
  total_turns: number;
  has_older_items: boolean;
  has_newer_items: boolean;
  /** Raw session.messageHistory index of the first message in this window. */
  start_index: number;
  section_turn_count: number;
  visible_section_count: number;
  window_hash?: string;
  /** Stable target looked up for this delivery, even if it could not be found. */
  target_message_id?: string;
  /**
   * Messages that answers in this window answer but that lie outside it, so
   * leader answer cards can quote them. Sent with every delivery, cache hits
   * included, since the window hash covers only the messages.
   */
  answered_messages?: AnsweredMessageReference[];
}

/** A direct human message an answer answers, as much as its quote and preview need. */
export interface AnsweredMessageReference {
  history_message_id: string;
  /** Session-scoped `uN` ID. */
  user_message_id: string;
  content: string;
  attachment_count?: number;
  annotations?: ConversationAnnotation[];
}

export interface ThreadWindowState {
  thread_key: string;
  from_item: number;
  item_count: number;
  total_items: number;
  has_older_items: boolean;
  has_newer_items: boolean;
  source_history_length: number;
  section_item_count: number;
  visible_item_count: number;
  /** Server-proven identity of the leading feed turn, stable when a window clips its activity. */
  leading_turn_id?: string;
  window_hash?: string;
  /** Stable target looked up for this delivery, even if it could not be found. */
  target_message_id?: string;
}

export interface InitialThreadWindowRequest {
  thread_key: string;
  from_item: number;
  item_count: number;
  section_item_count: number;
  visible_item_count: number;
  cached_window_hash?: string;
  target_message_id?: string;
  target_history_index?: number;
}
