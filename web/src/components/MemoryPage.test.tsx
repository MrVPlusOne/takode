// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryCatalogResponse, MemoryRecentCommit, MemoryRecordResponse, MemorySpacesResponse } from "../api.js";

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
    ],
  };
}

function recentCommit(overrides: Partial<MemoryRecentCommit> = {}): MemoryRecentCommit {
  return {
    sha: "abcdef123456",
    shortSha: "abcdef1",
    timestamp: 1_700_000_000_000,
    message: "Seed memory",
    authorName: "Takode Memory",
    authorEmail: "takode-memory@local",
    actor: "session:1576",
    quest: "q-1220",
    session: "session:1576",
    sources: ["q-1220"],
    changedFiles: [{ status: "A", path: "knowledge/service-x.md" }],
    ...overrides,
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
      {
        id: "decisions/memory-policy.md",
        kind: "decisions",
        path: "decisions/memory-policy.md",
        description: "Records how memory catalog freshness is evaluated.",
        source: ["q-1220"],
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
      recentCommits: [
        recentCommit(),
        recentCommit({
          sha: "bcdef234567",
          shortSha: "bcdef23",
          message: "Document procedure",
          actor: null,
          quest: null,
          session: null,
          sources: [],
          changedFiles: [{ status: "M", path: "procedures/run-service.md" }],
        }),
      ],
    },
  };
}

function catalogWithTwentyCommits(): MemoryCatalogResponse {
  return {
    ...catalogResponse(),
    git: {
      ...catalogResponse().git,
      recentCommits: Array.from({ length: 20 }, (_, index) =>
        recentCommit({
          sha: `abcdef${index}`.padEnd(12, "0"),
          shortSha: `c${index}`.padEnd(7, "0"),
          message: `Memory edit ${index}`,
          changedFiles: [{ status: "M", path: index % 2 ? "procedures/run-service.md" : "knowledge/service-x.md" }],
        }),
      ),
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

function recordResponse(path = "knowledge/service-x.md"): MemoryRecordResponse {
  if (path === "procedures/run-service.md") {
    return {
      repo: catalogResponse().repo,
      file: {
        id: "procedures/run-service.md",
        kind: "procedures",
        path: "procedures/run-service.md",
        absolutePath: "/Users/test/.companion/memory/prod/Takode/procedures/run-service.md",
        description: "Starts the local service.",
        source: ["q-1227"],
        frontmatter: {},
        body: "Run `bun run dev` from the web directory.",
        content: "---\ndescription: Starts the local service.\n---\n\nRun `bun run dev` from the web directory.",
      },
      issues: [],
    };
  }

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
    mockGetMemoryRecord.mockImplementation((opts?: { root?: string; path?: string }) =>
      Promise.resolve(opts?.root?.endsWith("/Other") ? otherRecordResponse() : recordResponse(opts?.path)),
    );
    mockOpenVsCodeRemoteFile.mockResolvedValue({ ok: true, sourceId: "source", commandId: "cmd" });
  });

  it("renders a dropdown space selector, grouped records, contained detail, and separate timeline", async () => {
    // Validates the structural replacement requested in feedback #9: no large Spaces column, simple rows, and a separate timeline.
    render(<MemoryPage embedded />);

    expect(await screen.findByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByLabelText("Memory space")).toHaveValue("/Users/test/.companion/memory/prod/Takode");
    expect(screen.queryByRole("complementary", { name: "Memory spaces" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /knowledge.*1/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /procedures.*1/i })).toBeInTheDocument();

    const knowledgeGroup = screen.getByRole("region", { name: "knowledge memory records" });
    expect(within(knowledgeGroup).getByText("service-x.md")).toBeInTheDocument();
    expect(within(knowledgeGroup).getByText("Explains Service X config and failure modes.")).toBeInTheDocument();
    expect(within(knowledgeGroup).queryByText("q-1220")).not.toBeInTheDocument();

    expect(await screen.findByText("Service X is started through a local dev command.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "q-1220" })[0]).toHaveAttribute("href", "#/questmaster?quest=q-1220");
    expect(screen.getByRole("link", { name: "session:1576:99" })).toHaveAttribute("href", "#/session/1576/msg/99");
    expect(screen.getByRole("region", { name: "Memory record detail" })).toHaveClass("min-w-0", "overflow-hidden");
    expect(screen.getByText("Recent memory edits")).toBeInTheDocument();
    expect(screen.getAllByText(/by session:1576/).length).toBeGreaterThan(0);
    expect(screen.getByText("source unknown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    await waitFor(() =>
      expect(mockOpenVsCodeRemoteFile).toHaveBeenCalledWith({
        absolutePath: "/Users/test/.companion/memory/prod/Takode/knowledge/service-x.md",
        targetKind: "file",
      }),
    );
  });

  it("selects memory spaces by dropdown root when sibling session spaces share a server slug", async () => {
    render(<MemoryPage embedded />);

    expect(await screen.findByText("Service X is started through a local dev command.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Memory space"), {
      target: { value: "/Users/test/.companion/memory/prod/Other" },
    });

    await waitFor(() =>
      expect(mockGetMemoryCatalog).toHaveBeenLastCalledWith({
        root: "/Users/test/.companion/memory/prod/Other",
        recentLimit: 20,
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

  it("collapses kind groups and filters simple record rows without clearing selected detail", async () => {
    render(<MemoryPage embedded />);

    expect(await screen.findByText("service-x.md")).toBeInTheDocument();
    const knowledgeGroup = screen.getByRole("region", { name: "knowledge memory records" });
    fireEvent.click(screen.getByRole("button", { name: /knowledge.*1/i }));
    expect(within(knowledgeGroup).queryByText("service-x.md")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /knowledge.*1/i }));
    expect(within(knowledgeGroup).getByText("service-x.md")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter memory"), { target: { value: "run-service" } });
    expect(screen.getByText("run-service.md")).toBeInTheDocument();
    expect(within(knowledgeGroup).queryByText("service-x.md")).not.toBeInTheDocument();
    expect(screen.getByText("Service X is started through a local dev command.")).toBeInTheDocument();
  });

  it("opens mobile drill-in detail and supports next/previous record navigation", async () => {
    render(<MemoryPage embedded />);

    const knowledgeGroup = await screen.findByRole("region", { name: "knowledge memory records" });
    fireEvent.click(within(knowledgeGroup).getByRole("button", { name: /service-x\.md/ }));

    const mobileDetail = screen.getByTestId("memory-mobile-detail");
    expect(within(mobileDetail).getByText("Memory record")).toBeInTheDocument();
    fireEvent.click(within(mobileDetail).getByRole("button", { name: "Next" }));

    expect(await within(mobileDetail).findByText("bun run dev")).toBeInTheDocument();
    fireEvent.click(within(mobileDetail).getByRole("button", { name: "Previous" }));
    expect(
      await within(mobileDetail).findByText("Service X is started through a local dev command."),
    ).toBeInTheDocument();

    fireEvent.click(within(mobileDetail).getByRole("button", { name: "Back to records" }));
    expect(screen.queryByTestId("memory-mobile-detail")).not.toBeInTheDocument();
  });

  it("loads more recent memory timeline entries from the read-only catalog API", async () => {
    mockGetMemoryCatalog.mockResolvedValue(catalogWithTwentyCommits());
    render(<MemoryPage embedded />);

    await screen.findByText("Memory edit 0");
    expect(mockGetMemoryCatalog).toHaveBeenLastCalledWith({
      root: "/Users/test/.companion/memory/prod/Takode",
      recentLimit: 20,
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() =>
      expect(mockGetMemoryCatalog).toHaveBeenLastCalledWith({
        root: "/Users/test/.companion/memory/prod/Takode",
        recentLimit: 40,
      }),
    );
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
