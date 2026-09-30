import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { resolveSessionNavigation } from "../utils/session-navigation-resolver.js";
import type { useSessionActions } from "../hooks/useSessionActions.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { ConfigureSessionModal } from "./ConfigureSessionModal.js";
import { buildMoveToSubmenu } from "./SidebarContextMenu.js";

export interface SessionMenuTarget {
  sessionId: string;
  x: number;
  y: number;
}

/** The same session menu for sidebar and header entrypoints. */
export function SessionContextMenu({
  target: contextMenu,
  onClose,
  onRename,
  actions,
}: {
  target: SessionMenuTarget | null;
  onClose: () => void;
  onRename: (sessionId: string, name: string) => void;
  actions: ReturnType<typeof useSessionActions>;
}) {
  const sdkSessions = useStore((s) => s.sdkSessions);
  const contextMenuBridge = useStore((s) => (contextMenu ? s.sessions.get(contextMenu.sessionId) : undefined));
  const currentSessionId = useStore((s) => s.currentSessionId);
  const contextMenuLeaderBridge = useStore((s) =>
    contextMenu && currentSessionId ? s.sessions.get(currentSessionId) : undefined,
  );
  const sessionAttention = useStore((s) => s.sessionAttention);
  const treeGroups = useStore((s) => s.treeGroups);
  const treeAssignments = useStore((s) => s.treeAssignments);
  const [configureSessionId, setConfigureSessionId] = useState<string | null>(null);
  return (
    <>
      {contextMenu &&
        (() => {
          const sdk = sdkSessions.find((s) => s.sessionId === contextMenu.sessionId);
          const bridge = contextMenuBridge;
          const sessionInfo = resolveSessionNavigation(useStore.getState(), contextMenu.sessionId)?.sidebarItem;
          if (!sdk && !bridge) return null;
          const cliId = sdk?.cliSessionId || "";
          const isArchived = sdk?.archived === true;
          const isExited = sdk?.state === "exited";
          const isPaused = !!(bridge?.pause ?? sdk?.pause);
          const attention = sessionAttention.get(contextMenu.sessionId);
          const backendType = bridge?.backend_type ?? sdk?.backendType ?? "claude";
          const currentLeaderSdk = sdkSessions.find((s) => s.sessionId === currentSessionId);
          const currentLeaderBridge = contextMenuLeaderBridge;
          const isCurrentLeader =
            currentLeaderBridge?.isOrchestrator === true || currentLeaderSdk?.isOrchestrator === true;
          const isTargetLeader = bridge?.isOrchestrator === true || sdk?.isOrchestrator === true;
          const canHerdToCurrentSession =
            !isArchived &&
            !isExited &&
            !!currentSessionId &&
            currentSessionId !== contextMenu.sessionId &&
            isCurrentLeader &&
            !isTargetLeader;
          const needsForceHerd = canHerdToCurrentSession && !!sdk?.herdedBy && sdk.herdedBy !== currentSessionId;

          // Count non-archived herded workers for the leader+herd archive option.
          const herdedWorkers =
            !isArchived && isTargetLeader
              ? sdkSessions.filter((worker) => worker.herdedBy === contextMenu.sessionId && !worker.archived)
              : [];

          const sessionNum = sessionInfo?.sessionNum ?? sdk?.sessionNum;
          const items: ContextMenuItem[] = [
            ...(sessionNum != null
              ? [
                  {
                    label: "Copy Session Number",
                    onClick: () => {
                      writeClipboardText(`#${sessionNum}`).catch(console.error);
                    },
                  },
                ]
              : [
                  {
                    label: "Copy Session ID",
                    onClick: () => {
                      writeClipboardText(contextMenu.sessionId).catch(console.error);
                    },
                  },
                ]),
            ...(cliId
              ? [
                  {
                    label: "Copy CLI Session ID",
                    onClick: () => {
                      writeClipboardText(cliId).catch(console.error);
                    },
                  },
                ]
              : []),
            {
              label: "Rename",
              onClick: () => {
                const name = sessionInfo?.name || "";
                onRename(contextMenu.sessionId, name);
              },
            },
            ...(!isArchived
              ? [
                  {
                    label: "Configure Session",
                    onClick: () => {
                      setConfigureSessionId(contextMenu.sessionId);
                    },
                  },
                ]
              : []),
            ...(!isArchived
              ? [
                  {
                    label: isPaused ? "Unpause Session" : "Pause Session",
                    onClick: () => {
                      void actions.handlePauseToggle(contextMenu.sessionId, isPaused);
                    },
                  },
                ]
              : []),
            ...(!isExited && !isArchived
              ? [
                  {
                    label: "Relaunch",
                    onClick: () => {
                      api.relaunchSession(contextMenu.sessionId).catch(console.error);
                    },
                  },
                ]
              : []),
            // Transport switch: only for Claude-family sessions that are alive
            ...(backendType === "claude" && !isExited && !isArchived
              ? [
                  {
                    label: "Switch to SDK",
                    onClick: () => {
                      api.upgradeTransport(contextMenu.sessionId).catch(console.error);
                    },
                  },
                ]
              : []),
            ...(backendType === "claude-sdk" && !isExited && !isArchived
              ? [
                  {
                    label: "Switch to WebSocket",
                    onClick: () => {
                      api.downgradeTransport(contextMenu.sessionId).catch(console.error);
                    },
                  },
                ]
              : []),
            attention
              ? {
                  label: "Mark as read",
                  onClick: () => {
                    api.markSessionRead?.(contextMenu.sessionId).catch(() => {});
                  },
                }
              : {
                  label: "Mark as unread",
                  onClick: () => {
                    api.markSessionUnread(contextMenu.sessionId).catch(() => {});
                  },
                },
            // Tree groups are now the only session-browsing mode in the sidebar.
            ...buildMoveToSubmenu(treeGroups, treeAssignments, contextMenu.sessionId),
            ...(canHerdToCurrentSession
              ? [
                  {
                    label: needsForceHerd ? "Force Herd to Current Session" : "Herd to Current Session",
                    onClick: () => {
                      void actions.doHerdToCurrentSession(contextMenu.sessionId, needsForceHerd);
                    },
                    ...(needsForceHerd
                      ? {
                          confirm: {
                            title: "Force herd takeover?",
                            description:
                              "This will move the session out of its current leader's herd into your current leader session.",
                            confirmLabel: "Force Herd",
                          },
                        }
                      : {}),
                  },
                ]
              : []),
            isArchived
              ? {
                  label: "Unarchive",
                  onClick: () => {
                    const syntheticEvent = { stopPropagation: () => {} } as React.MouseEvent;
                    void actions.handleUnarchiveSession(syntheticEvent, contextMenu.sessionId);
                  },
                }
              : {
                  label: "Archive",
                  onClick: () => {
                    const syntheticEvent = { stopPropagation: () => {} } as React.MouseEvent;
                    actions.handleArchiveSession(syntheticEvent, contextMenu.sessionId);
                  },
                },
            // Archives the leader and all active herded workers in one action.
            ...(herdedWorkers.length > 0
              ? [
                  {
                    label: "Archive Leader + Herd",
                    onClick: () => {
                      actions.doArchiveGroup(contextMenu.sessionId);
                    },
                    confirm: {
                      title: "Archive leader and herd?",
                      description: `This will archive the leader and ${herdedWorkers.length} worker session${herdedWorkers.length === 1 ? "" : "s"}.`,
                      confirmLabel: "Archive Leader + Herd",
                      destructive: true,
                    },
                  },
                ]
              : []),
            {
              label: "Delete Session",
              onClick: () => {
                const syntheticEvent = { stopPropagation: () => {} } as React.MouseEvent;
                void actions.handleDeleteSession(syntheticEvent, contextMenu.sessionId);
              },
              confirm: {
                title: "Delete session permanently?",
                description: "This cannot be undone. The session will be removed from history.",
                confirmLabel: "Delete",
                destructive: true,
              },
            },
          ];

          return (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={items}
              onClose={onClose}
              widthClassName="w-56 max-w-[calc(100vw-1rem)]"
              itemClassName="whitespace-normal break-words leading-snug"
            />
          );
        })()}
      {configureSessionId && (
        <ConfigureSessionModal sessionId={configureSessionId} onClose={() => setConfigureSessionId(null)} />
      )}
    </>
  );
}
