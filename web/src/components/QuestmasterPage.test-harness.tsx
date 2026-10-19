// Shared mocks, fixtures and DOM helpers for the QuestmasterPage test files.
// Vitest hoists vi.mock per test file, so each file declares its own mocks and
// points the factories at the module mocks exported here; they all read the
// same mockState and vi.fn() instances.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { compareSearchRanks, rankSearchFields } from "../../shared/search-utils.js";
import type { QuestmasterTask } from "../types.js";

export const mockCreateQuest = vi.fn();
export const mockListQuestPage = vi.fn();
export const mockGetSettings = vi.fn();
export const mockUpdateSettings = vi.fn();
export const mockUploadStandaloneQuestImage = vi.fn();
export const mockClipboardWriteText = vi.fn();
let promptSpy: ReturnType<typeof vi.spyOn>;

export function mockApiModule() {
  return {
    api: {
      createQuest: (...args: unknown[]) => mockCreateQuest(...args),
      listQuestPage: (...args: unknown[]) => mockListQuestPage(...args),
      listQuestPageValidated: async (options: unknown, request?: { signal?: AbortSignal }) => ({
        status: "fresh",
        data: await mockListQuestPage(options, request?.signal),
        etag: null,
      }),
      getQuest: (questId: string) => Promise.resolve(mockState.quests.find((quest) => quest.questId === questId)),
      getSettings: (...args: unknown[]) => mockGetSettings(...args),
      updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
      uploadStandaloneQuestImage: (...args: unknown[]) => mockUploadStandaloneQuestImage(...args),
      questImageUrl: (id: string) => `/api/quests/_images/${id}`,
    },
  };
}

export function mockViewStateModule() {
  return {
    loadQuestmasterViewState: () => null,
    saveQuestmasterViewState: vi.fn(),
  };
}

export function mockHighlightModule() {
  return {
    getHighlightParts: (text: string, query: string) => {
      if (!query) return [{ text, matched: false }];
      const index = text.toLowerCase().indexOf(query.toLowerCase());
      if (index < 0) return [{ text, matched: false }];
      return [
        { text: text.slice(0, index), matched: false },
        { text: text.slice(index, index + query.length), matched: true },
        { text: text.slice(index + query.length), matched: false },
      ].filter((part) => part.text.length > 0);
    },
  };
}

export function mockStoreModule() {
  const useStoreFn = (selector: (s: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  return {
    useStore: useStoreFn,
  };
}

type MockStoreState = {
  questDetails: Map<string, QuestmasterTask>;
  quests: QuestmasterTask[];
  questsLoading: boolean;
  refreshQuests: ReturnType<typeof vi.fn>;
  setQuests: (quests: QuestmasterTask[]) => void;
  upsertQuestDetail: (quest: QuestmasterTask) => void;
  questOverlayId: string | null;
  questOverlaySearchHighlight: string | null;
  questmasterSearchQuery: string;
  questmasterSelectedTags: string[];
  questmasterCompactSort: { column: string; direction: "asc" | "desc" } | null;
  setQuestmasterSearchQuery: ReturnType<typeof vi.fn>;
  setQuestmasterSelectedTags: ReturnType<typeof vi.fn>;
  setQuestmasterCompactSort: ReturnType<typeof vi.fn>;
  openQuestOverlay: ReturnType<typeof vi.fn>;
  closeQuestOverlay: ReturnType<typeof vi.fn>;
  replaceQuest: ReturnType<typeof vi.fn>;
  currentSessionId: string | null;
  sessions: Map<string, { memorySessionSpaceSlug?: string }>;
  sessionPreviews: Map<string, unknown>;
  sessionTaskHistory: Map<string, unknown>;
  pendingPermissions: Map<string, unknown>;
  cliConnected: Map<string, boolean>;
  sessionStatus: Map<string, string>;
  askPermission: Map<string, unknown>;
  cliDisconnectReason: Map<string, unknown>;
  // Required by SessionNumChip (used in card header)
  sdkSessions: Array<{
    sessionId: string;
    state: string;
    cwd: string;
    createdAt: number;
    archived: boolean;
    sessionNum?: number;
    backendType?: string;
    memorySessionSpaceSlug?: string;
    name?: string;
  }>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionBoards: Map<string, unknown[]>;
  sessionCompletedBoards: Map<string, unknown[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  zoomLevel: number;
};

export let mockState: MockStoreState;

function setDocumentVisibilityForQuestmasterTest(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

export type MockQuestPageOptions = {
  offset?: number;
  limit?: number;
  status?: string;
  tags?: string[];
  excludeTags?: string[];
  text?: string;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
};

type MockSearchRank = NonNullable<ReturnType<typeof rankSearchFields>>;

export function buildVerificationQuest(input: {
  id: string;
  questId: string;
  title: string;
  verificationInboxUnread?: boolean;
}): QuestmasterTask {
  return {
    id: input.id,
    questId: input.questId,
    version: 3,
    title: input.title,
    createdAt: Date.now(),
    status: "done",
    description: "Needs review",
    sessionId: "session-1",
    claimedAt: Date.now(),
    completedAt: Date.now(),
    verificationItems: [{ text: "Verify behavior", checked: false }],
    verificationInboxUnread: input.verificationInboxUnread,
    tags: ["ui", "questmaster"],
    updatedAt: Date.now(),
    feedback: [
      {
        author: "human",
        text: "Please verify this behavior",
        ts: Date.now(),
        addressed: false,
      },
    ],
  } as QuestmasterTask;
}

export function sessionRow(sessionId: string, sessionNum: number, name: string) {
  return { sessionId, sessionNum, name, state: "idle", cwd: "/repo", createdAt: 1, archived: false };
}

export function resetState(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    quests: [],
    questDetails: new Map(),
    questsLoading: false,
    refreshQuests: vi.fn().mockResolvedValue(undefined),
    setQuests: (quests: QuestmasterTask[]) => {
      mockState.quests = quests;
    },
    upsertQuestDetail: (quest: QuestmasterTask) => {
      mockState.questDetails.set(quest.questId.toLowerCase(), quest);
    },
    questOverlayId: null,
    questOverlaySearchHighlight: null,
    questmasterSearchQuery: "",
    questmasterSelectedTags: [] as string[],
    questmasterCompactSort: null,
    setQuestmasterSearchQuery: vi.fn((query: string) => {
      mockState.questmasterSearchQuery = query;
    }),
    setQuestmasterSelectedTags: vi.fn((tags: string[]) => {
      mockState.questmasterSelectedTags = tags;
    }),
    setQuestmasterCompactSort: vi.fn((sort: { column: string; direction: "asc" | "desc" }) => {
      mockState.questmasterCompactSort = sort;
    }),
    openQuestOverlay: vi.fn((questId: string, searchHighlight?: string) => {
      mockState.questOverlayId = questId;
      mockState.questOverlaySearchHighlight = searchHighlight ?? null;
    }),
    closeQuestOverlay: vi.fn(() => {
      mockState.questOverlayId = null;
      mockState.questOverlaySearchHighlight = null;
    }),
    replaceQuest: vi.fn(),
    currentSessionId: null,
    sessions: new Map(),
    sessionPreviews: new Map(),
    sessionTaskHistory: new Map(),
    pendingPermissions: new Map(),
    cliConnected: new Map(),
    sessionStatus: new Map(),
    askPermission: new Map(),
    cliDisconnectReason: new Map(),
    sdkSessions: [],
    sessionAttention: new Map(),
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    zoomLevel: 1,
    ...overrides,
  };
}

function makeQuestPage(quests: QuestmasterTask[], offset = 0, limit = 50, countsSource = quests) {
  return {
    quests: quests.slice(offset, offset + limit),
    total: quests.length,
    offset,
    limit,
    hasMore: offset + limit < quests.length,
    nextOffset: offset + limit < quests.length ? offset + limit : null,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    counts: {
      all: countsSource.length,
      idea: countsSource.filter((quest) => quest.status === "idea").length,
      refined: countsSource.filter((quest) => quest.status === "refined").length,
      in_progress: countsSource.filter((quest) => quest.status === "in_progress").length,
      done: countsSource.filter((quest) => quest.status === "done").length,
    },
    allTags: getMockAllTags(),
  };
}

function getMockAllTags() {
  return Array.from(
    new Set(mockState.quests.flatMap((quest) => quest.tags ?? []).map((tag) => tag.toLowerCase())),
  ).sort((a, b) => a.localeCompare(b));
}

function makeMockQuestPage(options: MockQuestPageOptions = {}) {
  const withoutStatus = mockState.quests.filter((quest) => {
    if (options.tags?.length) {
      const questTags = new Set((quest.tags ?? []).map((tag) => tag.toLowerCase()));
      if (!options.tags.some((tag) => questTags.has(tag.toLowerCase()))) return false;
    }
    if (options.excludeTags?.length) {
      const questTags = new Set((quest.tags ?? []).map((tag) => tag.toLowerCase()));
      if (options.excludeTags.some((tag) => questTags.has(tag.toLowerCase()))) return false;
    }
    if (options.text && !getMockSearchRank(quest, options.text)) return false;
    return true;
  });
  const statuses = new Set(
    (options.status ?? "")
      .split(",")
      .map((status) => status.trim())
      .filter(Boolean),
  );
  const filtered = statuses.size === 0 ? withoutStatus : withoutStatus.filter((quest) => statuses.has(quest.status));
  return makeQuestPage(sortMockQuests(filtered, options), options.offset ?? 0, options.limit ?? 50, withoutStatus);
}

function sortMockQuests(quests: QuestmasterTask[], options: MockQuestPageOptions) {
  if (options.text?.trim()) {
    return quests
      .map((quest) => ({ quest, rank: getMockSearchRank(quest, options.text ?? "") }))
      .filter((entry): entry is { quest: QuestmasterTask; rank: MockSearchRank } => entry.rank !== null)
      .sort((left, right) => compareMockRank(left.rank, right.rank) || compareMockQuestIds(left.quest, right.quest))
      .map((entry) => entry.quest);
  }

  const column = options.sortColumn ?? "cards";
  const direction = options.sortDirection ?? (column === "cards" ? "asc" : "desc");
  return [...quests].sort((left, right) => {
    const columnResult = compareMockSortColumn(left, right, column);
    const directed = direction === "asc" ? columnResult : -columnResult;
    return directed || mockQuestRecencyTs(right) - mockQuestRecencyTs(left) || compareMockQuestIds(left, right);
  });
}

function compareMockSortColumn(left: QuestmasterTask, right: QuestmasterTask, column: string) {
  switch (column) {
    case "cards": {
      const statusOrder: Record<string, number> = { in_progress: 0, refined: 1, idea: 2, done: 3 };
      return (
        statusOrder[left.status] - statusOrder[right.status] || mockQuestRecencyTs(right) - mockQuestRecencyTs(left)
      );
    }
    case "quest":
      return compareMockQuestIds(left, right);
    case "title":
      return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" });
    case "updated":
      return mockQuestRecencyTs(left) - mockQuestRecencyTs(right);
    default:
      return 0;
  }
}

function getMockSearchRank(quest: QuestmasterTask, query: string): MockSearchRank | null {
  const fields = [
    { rank: 0, text: quest.questId },
    { rank: 1, text: quest.title },
    { rank: 2, text: (quest.tags ?? []).join(" ") },
    { rank: 3, text: quest.tldr },
    { rank: 4, text: "description" in quest ? quest.description : undefined },
    { rank: 5, text: quest.status === "done" && quest.cancelled !== true ? quest.debriefTldr : undefined },
    { rank: 6, text: quest.status === "done" && quest.cancelled !== true ? quest.debrief : undefined },
    ...("feedback" in quest
      ? (quest.feedback ?? []).flatMap((entry) => [
          { rank: 7, text: entry.tldr },
          { rank: 8, text: entry.text },
        ])
      : []),
  ];
  return rankSearchFields(fields, query);
}

function compareMockRank(left: MockSearchRank, right: MockSearchRank) {
  return compareSearchRanks(left, right);
}

function compareMockQuestIds(left: QuestmasterTask, right: QuestmasterTask) {
  return left.questId.localeCompare(right.questId, undefined, { numeric: true, sensitivity: "base" });
}

function mockQuestRecencyTs(quest: QuestmasterTask) {
  return Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

export async function enterBackendSearch(input: HTMLElement, value: string, expectedText = value.trim()) {
  fireEvent.change(input, { target: { value } });
  await waitFor(() => {
    expectLastQuestPageCall({ text: expectedText });
  });
}

export function expectLastQuestPageCall(options: Partial<MockQuestPageOptions>) {
  expect(mockListQuestPage).toHaveBeenLastCalledWith(expect.objectContaining(options), expect.any(AbortSignal));
}

export function renderedQuestIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-quest-id]"))
    .map((el) => el.dataset.questId)
    .filter((questId): questId is string => !!questId);
}

/**
 * Whether any button carries this name. A document-wide `queryByRole` with a
 * name resolves every control's accessible name and took ~3 s per call with
 * 50 rendered rows; an absence check only needs the label and text.
 */
export function hasButtonNamed(name: string): boolean {
  return [...document.querySelectorAll<HTMLElement>("button, [role='button']")].some((el) =>
    el.hasAttribute("aria-label") ? el.getAttribute("aria-label") === name : el.textContent?.trim() === name,
  );
}

function getQuestmasterScrollContainer() {
  return screen.getByTestId("questmaster-scroll-container");
}

function setScrollMetrics(el: HTMLElement, metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(el, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  el.scrollTop = metrics.scrollTop;
}

export function scrollNearQuestmasterBottom() {
  const el = getQuestmasterScrollContainer();
  setScrollMetrics(el, { scrollTop: 880, clientHeight: 100, scrollHeight: 1_000 });
  fireEvent.scroll(el);
}

export async function settleLatestQuestPageRequest() {
  const latestResult = mockListQuestPage.mock.results.at(-1);
  if (!latestResult || latestResult.type !== "return") return;
  await act(async () => {
    await latestResult.value;
  });
}

/** Registers the per-test reset of mocks, fixtures and browser globals. */
export function installQuestmasterPageTestHooks() {
  beforeEach(() => {
    vi.clearAllMocks();
    setDocumentVisibilityForQuestmasterTest("hidden");
    promptSpy = vi.spyOn(window, "prompt").mockReturnValue("");
    mockClipboardWriteText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockClipboardWriteText } });
    const inboxQuest = buildVerificationQuest({
      id: "q-1-v3",
      questId: "q-1",
      title: "Fresh verification quest",
      verificationInboxUnread: true,
    });
    const regularQuest = buildVerificationQuest({
      id: "q-2-v3",
      questId: "q-2",
      title: "Regular verification quest",
      verificationInboxUnread: false,
    });
    resetState({
      quests: [inboxQuest, regularQuest],
    });
    mockListQuestPage.mockImplementation(async (options?: MockQuestPageOptions) => makeMockQuestPage(options));
    mockCreateQuest.mockImplementation(
      async (input: { title: string; description?: string; tags?: string[] }) =>
        ({
          id: "q-3-v1",
          questId: "q-3",
          version: 1,
          title: input.title,
          createdAt: Date.now(),
          status: "idea",
          description: input.description,
          tags: input.tags,
        }) as QuestmasterTask,
    );
    mockGetSettings.mockResolvedValue({
      questmasterCompactSort: { column: "updated", direction: "desc" },
    });
    mockUpdateSettings.mockImplementation(
      async (input: { questmasterCompactSort?: { column: string; direction: "asc" | "desc" } }) => ({
        questmasterCompactSort: input.questmasterCompactSort ??
          mockState.questmasterCompactSort ?? { column: "updated", direction: "desc" },
      }),
    );
    mockUploadStandaloneQuestImage.mockResolvedValue({
      id: "img-upload",
      filename: "draft.png",
      mimeType: "image/png",
      path: "/tmp/draft.png",
    });
    window.location.hash = "#/questmaster";
  });

  afterEach(() => {
    promptSpy.mockRestore();
    setDocumentVisibilityForQuestmasterTest("visible");
  });
}
