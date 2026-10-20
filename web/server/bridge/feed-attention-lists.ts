import type { BrowserIncomingMessage, SessionAttentionRecord, SessionNotification } from "../session-types.js";
import { versionsFor, type KeyedListSync, type KeyedListVersions } from "./keyed-list-versions.js";

/**
 * The notification list and attention records browsers place feed chips and
 * rows from. A busy leader's lists run to hundreds of KB, mostly resolved
 * entries that never change, and every change and every subscribe used to
 * send them whole. Browsers now get only what changed since a list they hold
 * (see `KeyedListVersions`), or nothing when they hold the current one.
 */

/** Versions browsers may hold stay usable for about this many changes, to cover a phone away for a while. */
const RECENT_LIST_VERSIONS = 32;

const idOf = (entry: { id: string }) => entry.id;

const notificationVersions = new WeakMap<object, KeyedListVersions<SessionNotification>>();
const attentionRecordVersions = new WeakMap<object, KeyedListVersions<SessionAttentionRecord>>();

type NotificationListFields = Pick<
  Extract<BrowserIncomingMessage, { type: "notification_update" }>,
  "notifications" | "notificationsDelta" | "notificationsHash"
>;
type AttentionRecordFields = Pick<
  Extract<BrowserIncomingMessage, { type: "attention_records_update" }>,
  "attentionRecords" | "attentionRecordsDelta" | "attentionRecordsHash"
>;

/** Notification list fields for a browser holding the list hashed `held`; one naming none gets the whole list. */
export function notificationListFields(
  session: object,
  notifications: SessionNotification[],
  held: string | undefined,
): NotificationListFields {
  return notificationFields(
    versionsFor(notificationVersions, session, idOf, RECENT_LIST_VERSIONS).sync(notifications, held),
  );
}

/** Attention record fields for a browser holding the records hashed `held`. */
export function attentionRecordFields(
  session: object,
  attentionRecords: SessionAttentionRecord[],
  held: string | undefined,
): AttentionRecordFields {
  return attentionFields(
    versionsFor(attentionRecordVersions, session, idOf, RECENT_LIST_VERSIONS).sync(attentionRecords, held),
  );
}

/**
 * A notification or attention record update for a session's browsers, sent
 * as what changed since the previous update. Other messages pass unchanged.
 */
export function projectFeedAttentionUpdateForBrowsers(
  session: object,
  msg: BrowserIncomingMessage,
): BrowserIncomingMessage {
  if (msg.type === "notification_update" && msg.notifications) {
    const { notifications, ...rest } = msg;
    return {
      ...rest,
      ...notificationFields(
        versionsFor(notificationVersions, session, idOf, RECENT_LIST_VERSIONS).broadcast(notifications),
      ),
    };
  }
  if (msg.type === "attention_records_update" && msg.attentionRecords) {
    const { attentionRecords, ...rest } = msg;
    return {
      ...rest,
      ...attentionFields(
        versionsFor(attentionRecordVersions, session, idOf, RECENT_LIST_VERSIONS).broadcast(attentionRecords),
      ),
    };
  }
  return msg;
}

function notificationFields(sync: KeyedListSync<SessionNotification>): NotificationListFields {
  return {
    notificationsHash: sync.hash,
    ...(sync.list ? { notifications: sync.list } : {}),
    ...(sync.delta ? { notificationsDelta: sync.delta } : {}),
  };
}

function attentionFields(sync: KeyedListSync<SessionAttentionRecord>): AttentionRecordFields {
  return {
    attentionRecordsHash: sync.hash,
    ...(sync.list ? { attentionRecords: sync.list } : {}),
    ...(sync.delta ? { attentionRecordsDelta: sync.delta } : {}),
  };
}
