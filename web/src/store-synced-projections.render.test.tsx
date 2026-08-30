// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../shared/synced-projection.js";
import { getSessionAttentionProjection } from "./store-synced-projections.js";

vi.mock("./api.js", () => ({
  api: {
    markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
    markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { useStore } from "./store.js";

function envelope(revision: number, count = 1) {
  return {
    type: "synced_projection_snapshot",
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_ATTENTION_PROJECTION,
    key: "s1",
    generation: "generation-a",
    revision,
    value: {
      attentionReason: "review",
      status: { urgency: "review", count },
    },
  } as const;
}

function ProjectionProbe({ onRender }: { onRender: () => void }) {
  const projection = useStore((state) => getSessionAttentionProjection(state, "s1"));
  onRender();
  return <div>{projection?.status?.count ?? "missing"}</div>;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

describe("synced projection selector identity", () => {
  it("does not rerender a selected value for an equal newer snapshot", () => {
    const onRender = vi.fn();
    render(<ProjectionProbe onRender={onRender} />);
    expect(screen.getByText("missing")).toBeTruthy();

    act(() => {
      useStore.getState().applySyncedProjectionSnapshot(envelope(1));
    });
    expect(screen.getByText("1")).toBeTruthy();
    expect(onRender).toHaveBeenCalledTimes(2);

    act(() => {
      useStore.getState().applySyncedProjectionSnapshot(envelope(2));
    });
    expect(screen.getByText("1")).toBeTruthy();
    expect(onRender).toHaveBeenCalledTimes(2);

    act(() => {
      useStore.getState().applySyncedProjectionSnapshot(envelope(3, 2));
    });
    expect(screen.getByText("2")).toBeTruthy();
    expect(onRender).toHaveBeenCalledTimes(3);
  });
});
