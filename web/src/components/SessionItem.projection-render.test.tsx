// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { Profiler, type ComponentProps, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../../shared/session-attention-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../../shared/synced-projection.js";
import { useStore } from "../store.js";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";
import { SessionItem } from "./SessionItem.js";

function session(id: string): SidebarSessionItem {
  return {
    id,
    model: "gpt-5.6",
    cwd: "/repo",
    gitBranch: "jiayi",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: 1,
    archived: false,
    backendType: "codex",
    repoRoot: "/repo",
    permCount: 0,
  };
}

const commonProps: Omit<ComponentProps<typeof SessionItem>, "session" | "sessionName"> = {
  isActive: false,
  isArchived: false,
  sessionPreview: undefined,
  permCount: 0,
  isRecentlyRenamed: false,
  onSelect: () => {},
  onStartRename: () => {},
  onArchive: () => {},
  onUnarchive: () => {},
  onDelete: () => {},
  onClearRecentlyRenamed: () => {},
  editingSessionId: null,
  editingName: "",
  setEditingName: () => {},
  onConfirmRename: () => {},
  onCancelRename: () => {},
  editInputRef: { current: null },
};

function envelope(options: {
  sessionId: string;
  revision: number;
  reason: "action" | "review";
  urgency: "needs-input" | "review";
  count: number;
  type?: "synced_projection_snapshot" | "synced_projection_update";
}) {
  return {
    type: options.type ?? "synced_projection_snapshot",
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_ATTENTION_PROJECTION,
    key: options.sessionId,
    generation: "render-generation",
    revision: options.revision,
    value: {
      attentionReason: options.reason,
      status: { urgency: options.urgency, count: options.count },
    },
  } as const;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

afterEach(() => {
  useStore.getState().reset();
});

describe("SessionItem projection selectors", () => {
  it("skips count-only row renders and rerenders only the row whose visual projection changes", () => {
    useStore.getState().applySyncedProjectionSnapshot(
      envelope({
        sessionId: "s1",
        revision: 1,
        reason: "review",
        urgency: "review",
        count: 1,
      }),
    );
    useStore.getState().applySyncedProjectionSnapshot(
      envelope({
        sessionId: "s2",
        revision: 1,
        reason: "review",
        urgency: "review",
        count: 1,
      }),
    );

    const renderCounts = new Map<string, number>();
    const onRender: ProfilerOnRenderCallback = (id) => {
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    };
    const view = render(
      <>
        <Profiler id="s1" onRender={onRender}>
          <SessionItem session={session("s1")} sessionName="First" {...commonProps} />
        </Profiler>
        <Profiler id="s2" onRender={onRender}>
          <SessionItem session={session("s2")} sessionName="Second" {...commonProps} />
        </Profiler>
      </>,
    );
    expect(renderCounts).toEqual(
      new Map([
        ["s1", 1],
        ["s2", 1],
      ]),
    );

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        envelope({
          sessionId: "s1",
          revision: 2,
          reason: "review",
          urgency: "review",
          count: 2,
          type: "synced_projection_update",
        }),
      );
    });
    expect(renderCounts).toEqual(
      new Map([
        ["s1", 1],
        ["s2", 1],
      ]),
    );

    act(() => {
      useStore.getState().applySyncedProjectionUpdate(
        envelope({
          sessionId: "s1",
          revision: 3,
          reason: "action",
          urgency: "needs-input",
          count: 1,
          type: "synced_projection_update",
        }),
      );
    });
    expect(renderCounts).toEqual(
      new Map([
        ["s1", 2],
        ["s2", 1],
      ]),
    );

    view.unmount();
  });
});
