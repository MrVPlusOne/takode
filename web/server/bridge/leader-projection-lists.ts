import type { LeaderProjectionSnapshot, LeaderProjectionThreadSummary } from "../leader-projection-types.js";
import type { BrowserIncomingMessage, SessionAttentionRecord } from "../session-types.js";
import type { KnownSnapshotParts } from "../../shared/snapshot-part-hash.js";
import { versionsFor, type KeyedListVersions } from "./keyed-list-versions.js";

type LeaderProjectionMessage = Extract<BrowserIncomingMessage, { type: "leader_projection_snapshot" }>;

/**
 * A leader's projection lists one summary per thread it ever had (hundreds on
 * a busy leader, about 40 KB) and only a few change between two visits. A
 * browser naming the lists it holds gets only what changed, or nothing.
 */
const RECENT_PROJECTION_VERSIONS = 16;

const threadSummaryVersions = new WeakMap<object, KeyedListVersions<LeaderProjectionThreadSummary>>();
const attentionRecordVersions = new WeakMap<object, KeyedListVersions<SessionAttentionRecord>>();

/** The `leader_projection_snapshot` for a browser holding the projection lists named in `held`. */
export function leaderProjectionMessage(
  session: object,
  projection: LeaderProjectionSnapshot,
  held: KnownSnapshotParts | undefined,
): LeaderProjectionMessage {
  const { threadSummaries, messageAttentionRecords, ...rest } = projection;
  const summaries = versionsFor(
    threadSummaryVersions,
    session,
    (summary) => summary.threadKey,
    RECENT_PROJECTION_VERSIONS,
  ).sync(threadSummaries, held?.thread_summaries);
  const records = versionsFor(attentionRecordVersions, session, (record) => record.id, RECENT_PROJECTION_VERSIONS).sync(
    messageAttentionRecords,
    held?.message_attention_records,
  );
  return {
    type: "leader_projection_snapshot",
    projection: {
      ...rest,
      ...(summaries.list ? { threadSummaries: summaries.list } : {}),
      ...(records.list ? { messageAttentionRecords: records.list } : {}),
    },
    threadSummariesHash: summaries.hash,
    ...(summaries.delta ? { threadSummariesDelta: summaries.delta } : {}),
    messageAttentionRecordsHash: records.hash,
    ...(records.delta ? { messageAttentionRecordsDelta: records.delta } : {}),
  };
}
