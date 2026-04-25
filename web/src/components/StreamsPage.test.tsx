// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamGroupsResponse } from "../api.js";
import type { StreamRecord } from "../types.js";

const mockListStreamGroups = vi.fn();
const mockGetStreamDetail = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listStreamGroups: (...args: unknown[]) => mockListStreamGroups(...args),
    getStreamDetail: (...args: unknown[]) => mockGetStreamDetail(...args),
  },
}));

import { StreamsPage } from "./StreamsPage.js";

function stream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    id: "s-1",
    slug: "judge-lane-monitor",
    title: "Judge lane monitor",
    scope: "server-test:session-group:ml",
    status: "blocked",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
    current: {
      summary: "Four lanes active",
      health: "degraded",
      operationalStatus: "watching runner output",
      paperworkStatus: "quest summary pending",
      blockedOn: "runner health check",
      nextCheckAt: "2026-04-25T17:00:00.000Z",
      lastVerifiedAt: "2026-04-25T16:45:00.000Z",
      openDecisions: ["whether to relaunch lane c"],
      knownStaleFacts: ["old two-lane timer"],
      activeTimers: ["refresh monitor"],
    },
    owners: [{ ref: "989", role: "leader", steeringMode: "leader-steered" }],
    links: [
      { type: "quest", ref: "q-679" },
      { type: "session", ref: "989" },
      { type: "artifact", ref: "/tmp/judge-report.json" },
    ],
    pinnedFacts: [
      {
        id: "pf-1",
        text: "Expected four judging lanes",
        status: "active",
        createdAt: 1_700_000_010_000,
        source: "session:989:12",
      },
      {
        id: "pf-2",
        text: "Old two-lane timer is no longer correct",
        status: "superseded",
        createdAt: 1_700_000_020_000,
        supersededBy: "pf-1",
      },
    ],
    timeline: [
      {
        id: "e-1",
        type: "alert",
        text: "Outputs flat in one lane",
        ts: 1_700_000_050_000,
        source: "session:989:99",
        confidence: "observed",
        artifacts: ["/tmp/judge-report.json"],
        links: [{ type: "message", ref: "989:99" }],
      },
    ],
    ...overrides,
  };
}

function response(records: StreamRecord[]): StreamGroupsResponse {
  return {
    serverId: "server-test",
    includeArchived: false,
    query: "",
    groups: [
      {
        group: { id: "ml", name: "ML Ops" },
        scope: "server-test:session-group:ml",
        streams: records,
        counts: {
          total: records.length,
          active: records.filter((item) => item.status !== "archived").length,
          archived: records.filter((item) => item.status === "archived").length,
          blocked: records.filter((item) => item.status === "blocked").length,
          risk: 1,
          alerts: 1,
          contradictions: 0,
          handoffs: 0,
        },
      },
    ],
  };
}

describe("StreamsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const record = stream();
    mockListStreamGroups.mockResolvedValue(response([record]));
    mockGetStreamDetail.mockResolvedValue({
      scope: record.scope,
      stream: record,
      children: [stream({ id: "s-2", title: "Route surface" })],
    });
  });

  it("renders current stream state before provenance and timeline details", async () => {
    // Verifies the page is a current-state-first observability/debugging view
    // over the q-682 StreamRecord shape, including links, owners, stale facts, and artifacts.
    render(<StreamsPage embedded />);

    expect(await screen.findByText("Streams")).toBeInTheDocument();
    expect(screen.getByText("ML Ops")).toBeInTheDocument();
    expect(screen.getAllByText("Judge lane monitor").length).toBeGreaterThan(0);
    expect(screen.getByText("Current State")).toBeInTheDocument();
    expect(screen.getAllByText("Four lanes active").length).toBeGreaterThan(0);
    expect(screen.getByText("runner health check")).toBeInTheDocument();
    expect(screen.getByText(/leader: 989/)).toBeInTheDocument();
    expect(screen.getByText("Expected four judging lanes")).toBeInTheDocument();
    expect(screen.getByText("pf-2 / superseded / superseded by pf-1")).toBeInTheDocument();
    expect(screen.getByText("Artifacts: /tmp/judge-report.json")).toBeInTheDocument();
    expect(screen.getByText("Outputs flat in one lane")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGetStreamDetail).toHaveBeenCalledWith("server-test:session-group:ml", "judge-lane-monitor"),
    );
  });

  it("reloads stream groups with archived and search filters", async () => {
    // Verifies the page exposes postmortem/search controls without requiring callers to pass explicit scopes.
    render(<StreamsPage embedded />);

    await screen.findAllByText("Judge lane monitor");
    fireEvent.click(screen.getByLabelText("Include archived"));
    await waitFor(() => expect(mockListStreamGroups).toHaveBeenLastCalledWith({ includeArchived: true, query: "" }));

    fireEvent.change(screen.getByLabelText("Search streams"), { target: { value: "flat" } });
    await waitFor(() =>
      expect(mockListStreamGroups).toHaveBeenLastCalledWith({ includeArchived: true, query: "flat" }),
    );
  });
});
