import type { SdkSessionInfo } from "../types.js";
import { toSessionViewModel, type SessionViewModel } from "./session-view-model.js";
import { toSidebarSessionItem, type SidebarSessionItem } from "./sidebar-session-item.js";

export interface SessionNavigationResolverSource {
  sdkSessions: SdkSessionInfo[];
}

export interface ResolvedSessionNavigation {
  sidebarItem: SidebarSessionItem;
  viewModel: SessionViewModel;
}

const resolvedSessionNavigationCache = new WeakMap<SdkSessionInfo, ResolvedSessionNavigation>();

function resolveSdkSessionNavigation(session: SdkSessionInfo): ResolvedSessionNavigation {
  const cached = resolvedSessionNavigationCache.get(session);
  if (cached) return cached;

  const result: ResolvedSessionNavigation = {
    sidebarItem: toSidebarSessionItem(session),
    viewModel: toSessionViewModel(session),
  };
  resolvedSessionNavigationCache.set(session, result);
  return result;
}

export function resolveSessionNavigation<TSource extends SessionNavigationResolverSource>(
  source: TSource,
  sessionId: string,
): ResolvedSessionNavigation | null {
  const session = source.sdkSessions.find((candidate) => candidate.sessionId === sessionId);
  return session ? resolveSdkSessionNavigation(session) : null;
}
