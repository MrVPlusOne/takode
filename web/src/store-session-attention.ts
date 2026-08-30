import type { StateCreator } from "zustand";
import { api } from "./api.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { hasSyncedProjectionValue } from "./store-synced-projections.js";
import type { AppState } from "./store-types.js";

type StoreSet = Parameters<StateCreator<AppState>>[0];
type SessionAttentionStoreSlice = Pick<
  AppState,
  "markSessionViewed" | "markSessionUnread" | "markAllSessionsViewed" | "clearSessionAttention"
>;

/** Explicit attention commands with optimism limited to legacy-owned keys. */
export function createSessionAttentionStoreSlice(set: StoreSet): SessionAttentionStoreSlice {
  return {
    markSessionViewed: (sessionId) =>
      set((state) => {
        if (
          hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, sessionId) ||
          state.sessionAttention.get(sessionId) === null
        ) {
          return state;
        }
        const sessionAttention = new Map(state.sessionAttention);
        sessionAttention.set(sessionId, null);
        return { sessionAttention };
      }),
    markSessionUnread: (sessionId) => {
      api.markSessionUnread(sessionId).catch(() => {});
      set((state) => {
        if (
          hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, sessionId) ||
          state.sessionAttention.get(sessionId) === "review"
        ) {
          return state;
        }
        const sessionAttention = new Map(state.sessionAttention);
        sessionAttention.set(sessionId, "review");
        return { sessionAttention };
      });
    },
    markAllSessionsViewed: () => {
      api.markAllSessionsRead().catch(() => {});
      set((state) => {
        let sessionAttention: Map<string, "action" | "error" | "review" | null> | null = null;
        for (const sdk of state.sdkSessions) {
          if (
            hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, sdk.sessionId) ||
            state.sessionAttention.get(sdk.sessionId) === null
          ) {
            continue;
          }
          sessionAttention ??= new Map(state.sessionAttention);
          sessionAttention.set(sdk.sessionId, null);
        }
        return sessionAttention ? { sessionAttention } : state;
      });
    },
    clearSessionAttention: (sessionId) =>
      set((state) => {
        if (
          hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, sessionId) ||
          state.sessionAttention.get(sessionId) === null
        ) {
          return state;
        }
        const sessionAttention = new Map(state.sessionAttention);
        sessionAttention.set(sessionId, null);
        return { sessionAttention };
      }),
  };
}
