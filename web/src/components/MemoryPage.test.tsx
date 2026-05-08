// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryCatalogResponse, MemoryRecordResponse, MemorySpacesResponse } from "../api.js";

const mockListMemorySpaces = vi.fn();
const mockGetMemoryCatalog = vi.fn();
const mockGetMemoryRecord = vi.fn();
const mockOpenVsCodeRemoteFile = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listMemorySpaces: (...args: unknown[]) => mockListMemorySpaces(...args),
    getMemoryCatalog: (...args: unknown[]) => mockGetMemoryCatalog(...args),
    getMemoryRecord: (...args: unknown[]) => mockGetMemoryRecord(...args),
    openVsCodeRemoteFile: (...args: unknown[]) => mockOpenVsCodeRemoteFile(...args),
  },
}));

import { MemoryPage } from "./MemoryPage.js";

function spacesResponse(): MemorySpacesResponse {
  return {
    currentServerId: "server-test",
    currentServerSlug: "prod",
    currentSessionSpaceSlug: "Takode",
    spaces: [
      {
        slug: "prod",
        root: "/Users/test/.companion/memory/prod/Takode",
        current: true,
        initialized: true,
        authoredDirs: ["current", "knowledge", "procedures", "decisions", "references", "artifacts"],
        hasAuthoredData: true,
        sessionSpaceSlug: "Takode",
        serverId: "server-test",
      },
      {
        slug: "prod",
        root: "/Users/test/.companion/memory/prod/Other",
        current: false,
        initialized: true,
        authoredDirs: ["current"],
        hasAuthoredData: true,
        sessionSpaceSlug: "Other",
        serverId: "server-test",
      },
      {
        slug: "dev",
        root: "/Users/test/.companion/memory/dev",
        current: false,
        initialized: true,
        authoredDirs: ["current", "knowledge"],
        hasAuthoredData: true,
      },
    ],
  };
}

function catalogResponse(): MemoryCatalogResponse {
  return {
    repo: {
      root: "/Users/test/.companion/memory/prod/Takode",
      serverId: "server-test",
      serverSlug: "prod",
      sessionSpaceSlug: "Takode",
      initialized: true,
      authoredDirs: ["current", "knowledge", "procedures", "decisions", "references", "artifacts"],
    },
    entries: [
      {
        id: "knowledge/service-x.md",
        kind: "knowledge",
        path: "knowledge/service-x.md",
        description: "Explains Service X config and failure modes.",
        source: ["q-1220", "session:1576:99"],
        facets: { project: ["takode"] },
      },
      {
        id: "procedures/run-service.md",
        kind: "procedures",
        path: "procedures/run-service.md",
        description: "Starts the local service.",
        source: ["q-1227"],
        facets: {},
      },
    ],
    issues: [
      {
        severity: "warning",
        path: "knowledge/service-x.md",
        message: 'Obsolete memory frontmatter field "title" is ignored.',
      },
    ],
    issueCounts: { errors: 0, warnings: 1 },
    lock: { locked: false, lockPath: "/Users/test/.companion/memory/prod/Takode/.git/takode-memory.lock" },
    git: {
      dirty: true,
      status: "?? current/live.md",
      statusEntries: [{ code: "??", path: "current/live.md", raw: "?? current/live.md" }],
      recentCommits: [{ sha: "abcdef1", shortSha: "abcdef1", timestamp: 1_700_000_000_000, message: "Seed memory" }],
    },
  };
}

function otherCatalogResponse(): MemoryCatalogResponse {
  return {
    ...catalogResponse(),
    repo: {
      root: "/Users/test/.companion/memory/prod/Other",
      serverId: "server-test",
      serverSlug: "prod",
      sessionSpaceSlug: "Other",
      initialized: true,
      authoredDirs: ["current"],
    },
    entries: [
      {
        id: "current/other-state.md",
        kind: "current",
        path: "current/other-state.md",
        description: "Other session-space state.",
        source: ["q-1237"],
        facets: {},
      },
    ],
    issues: [],
    issueCounts: { errors: 0, warnings: 0 },
    git: { dirty: false, status: "", statusEntries: [], recentCommits: [] },
  };
}

function recordResponse(): MemoryRecordResponse {
  return {
    repo: catalogResponse().repo,
    file: {
      id: "knowledge/service-x.md",
      kind: "knowledge",
      path: "knowledge/service-x.md",
      absolutePath: "/Users/test/.companion/memory/prod/Takode/knowledge/service-x.md",
      description: "Explains Service X config and failure modes.",
      source: ["q-1220", "session:1576:99"],
      frontmatter: { facets: { project: ["takode"] } },
      body: "Service X is started through a local dev command.",
      content: "---\ndescription: Explains Service X config and failure modes.\n---\n\nService X",
    },
    issues: [
      {
        severity: "warning",
        path: "knowledge/service-x.md",
        message: 'Obsolete memory frontmatter field "title" is ignored.',
      },
    ],
  };
}

function otherRecordResponse(): MemoryRecordResponse {
  return {
    repo: otherCatalogResponse().repo,
    file: {
      id: "current/other-state.md",
      kind: "current",
      path: "current/other-state.md",
      absolutePath: "/Users/test/.companion/memory/prod/Other/current/other-state.md",
      description: "Other session-space state.",
      source: ["q-1237"],
      frontmatter: {},
      body: "Other memory detail.",
      content: "---\ndescription: Other session-space state.\n---\n\nOther memory detail.",
    },
    issues: [],
  };
}

describe("MemoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMemorySpaces.mockResolvedValue(spacesResponse());
    mockGetMemoryCatalog.mockImplementation((opts?: { root?: string }) =>
      Promise.resolve(opts?.root?.endsWith("/Other") ? otherCatalogResponse() : catalogResponse()),
    );
    mockGetMemoryRecord.mockImplementation((opts?: { root?: string }) =>
      Promise.resolve(opts?.root?.endsWith("/Other") ? otherRecordResponse() : recordResponse()),
    );
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "source", commandId: "cmd" });
  });

  it("renders memory spaces, catalog health, provenance, dirty status, and record detail", async () => {
    // Verifies the replacement page is a read-only catalog/detail Memory view rather than the old stream dashboard.
    render(<MemoryPage embedded />);

    expect(await screen.findByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Memory spaces" })).toHaveClass(
      "flex",
      "min-h-0",
      "flex-col",
      "overflow-hidden",
    );
    expect(screen.getByTestId("memory-spaces-list")).toHaveClass("min-h-0", "flex-1", "lg:overflow-y-auto");
    expect(screen.getAllByText("prod/Takode").length).toBeGreaterThan(0);
    expect(screen.getAllByText("prod/Other").length).toBeGreaterThan(0);
    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(await screen.findByText("1 warnings")).toBeInTheDocument();
    expect(screen.getByText("dirty")).toBeInTheDocument();
    expect(screen.getByText("?? current/live.md")).toBeInTheDocument();
    expect(screen.getAllByText("knowledge/service-x.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("service-x.md").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Explains Service X config and failure modes.").length).toBeGreaterThan(0);
    expect(screen.getByText("Markdown preview")).toBeInTheDocument();
    expect(await screen.findByText("Service X is started through a local dev command.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "q-1220" })).toHaveAttribute("href", "#/questmaster?quest=q-1220");
    expect(screen.getByRole("link", { name: "session:1576:99" })).toHaveAttribute("href", "#/session/1576/msg/99");

    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    await waitFor(() =>
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/Users/test/.companion/memory/prod/Takode/knowledge/service-x.md",
        targetKind: "file",
      }),
    );
  });

  it("selects memory spaces by root when sibling session spaces share a server slug", async () => {
    render(<MemoryPage embedded />);

    expect(await screen.findByText("Service X is started through a local dev command.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /prod\/Other/ }));

    await waitFor(() =>
      expect(mockGetMemoryCatalog).toHaveBeenLastCalledWith({
        root: "/Users/test/.companion/memory/prod/Other",
      }),
    );
    expect(await screen.findByText("Other memory detail.")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGetMemoryRecord).toHaveBeenLastCalledWith({
        root: "/Users/test/.companion/memory/prod/Other",
        path: "current/other-state.md",
      }),
    );
  });

  it("filters catalog rows by query and kind without hiding the selected detail", async () => {
    render(<MemoryPage embedded />);

    await screen.findByText("knowledge/service-x.md");
    fireEvent.change(screen.getByLabelText("Filter memory"), { target: { value: "run-service" } });
    expect(screen.getByText("run-service.md")).toBeInTheDocument();
    expect(screen.getByText("procedures/")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "knowledge 1" }));
    expect(screen.getByText("No memory records match this filter.")).toBeInTheDocument();
    expect(screen.getByText("Service X is started through a local dev command.")).toBeInTheDocument();
  });

  it("shows empty and error states with concrete backend messages", async () => {
    mockListMemorySpaces.mockResolvedValueOnce({
      ...spacesResponse(),
      spaces: [spacesResponse().spaces[0]!],
    });
    mockGetMemoryCatalog.mockResolvedValueOnce({
      ...catalogResponse(),
      entries: [],
      issues: [],
      issueCounts: { errors: 0, warnings: 0 },
      git: { dirty: false, status: "", statusEntries: [], recentCommits: [] },
    });
    render(<MemoryPage embedded />);

    expect(
      await screen.findByText("This memory repo has no Markdown records in authored directories."),
    ).toBeInTheDocument();

    mockGetMemoryCatalog.mockRejectedValueOnce(new Error("memory repo unavailable"));
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Failed to load catalog: memory repo unavailable")).toBeInTheDocument();
  });
});
