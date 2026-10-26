import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QuestmasterTask, QuestTitlePreview, SdkSessionInfo } from "../../types.js";
import { useStore } from "../../store.js";
import { seedLeaderTopics } from "../../utils/leader-topics.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { QuestFeedInlineLink } from "../QuestFeedInlineLink.js";
import { QuestQuizSection } from "../QuestQuizSection.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

type PreviewFixtureState =
  | "idle"
  | "title"
  | "no-fit"
  | "rich"
  | "error"
  | "keyboard"
  | "coarse"
  | "link-touch"
  | "cancelled"
  | "dense";

const PREVIEW_WORKER_SESSION_ID = "playground-inline-preview-worker";
const PREVIEW_LEADER_SESSION_ID = "playground-inline-preview-leader";
const PREVIEW_REVIEWER_SESSION_ID = "playground-inline-preview-reviewer";
// The link-tap fixture is an active quest with a running worker, a reviewer and numbered sessions,
// so the phone sheet shows the session buttons, live status and latest phase as a real quest would.
const PREVIEW_SESSIONS = [
  { sessionId: PREVIEW_WORKER_SESSION_ID, sessionNum: 41, name: "Preview worker" },
  { sessionId: PREVIEW_LEADER_SESSION_ID, sessionNum: 7, name: "Preview leader" },
  { sessionId: PREVIEW_REVIEWER_SESSION_ID, sessionNum: 42, name: "Preview reviewer" },
] as const;

interface PreviewFixtureDefinition {
  id: PreviewFixtureState;
  label: string;
  buttonLabel: string;
  questId: string;
  title: string;
  description: string;
}

const PREVIEW_FIXTURES: readonly PreviewFixtureDefinition[] = [
  {
    id: "idle",
    label: "Idle",
    buttonLabel: "Show idle state",
    questId: "q-9410",
    title: "Keep exact chat links independently navigable",
    description: "The exact anchor and the jump-to-thread icon after it are both present before any interaction.",
  },
  {
    id: "title",
    label: "Link focus / title",
    buttonLabel: "Show link-focus title preview",
    questId: "q-9411",
    title: "Keep link focus limited to the title-only preview",
    description:
      "Keyboard focus on the native text link reveals its pointer-inert title and current validated status; the icon stays separate.",
  },
  {
    id: "no-fit",
    label: "Wrapped / no-fit",
    buttonLabel: "Show wrapped no-fit state",
    questId: "q-9412",
    title: "Keep the wrapped exact link usable when no title placement is legal",
    description:
      "Visible dense neighboring controls make the real wrapped-link title layer report no-fit and stay hidden.",
  },
  {
    id: "rich",
    label: "Icon hover / rich",
    buttonLabel: "Show fine-pointer icon-hover details",
    questId: "q-9413",
    title: "Reveal rich quest context by hovering the thread icon",
    description:
      "Fine-pointer entry on the thread icon hydrates the local by-ID fixture, opens near the icon, and puts Open Worker and Open Thread at the top. Clicking the icon goes straight to the quest's thread.",
  },
  {
    id: "error",
    label: "Icon hover / error",
    buttonLabel: "Show icon-hover hydration error",
    questId: "q-9414",
    title: "Retain exact navigation when icon details fail to hydrate",
    description:
      "Icon hover drives a deterministic loader rejection so Retry, direct navigation, and Close remain inspectable.",
  },
  {
    id: "keyboard",
    label: "No thread / keyboard",
    buttonLabel: "Show keyboard activation without a thread",
    questId: "q-9415",
    title: "Open the preview when the quest has no thread to go to",
    description:
      "The icon receives focus without opening a title layer; with no leader thread, Enter opens the labelled rich surface instead of jumping.",
  },
  {
    id: "coarse",
    label: "No thread / touch",
    buttonLabel: "Show first touch without a thread",
    questId: "q-9416",
    title: "Fall back to the modal sheet when a tapped quest has no thread",
    description:
      "A first touch on the icon of a quest with no leader thread opens the real modal sheet and forces the Playground's enlarged touch target.",
  },
  {
    id: "link-touch",
    label: "Link tap / sheet",
    buttonLabel: "Show touch tap on the text link",
    questId: "q-9418",
    title: "Preview the quest when a message link is tapped",
    description:
      "A touch tap on the text link opens the same modal sheet, with Open Worker, Open Thread and its large Open action pinned at the bottom; a mouse or keyboard click opens the full view.",
  },
  {
    id: "cancelled",
    label: "Cancelled / no TLDR",
    buttonLabel: "Show a cancelled quest without a TLDR",
    questId: "q-9419",
    title: "Live check: automatic User Checkpoint",
    description:
      "A cancelled quest with a description but no TLDR, taken off the board: the sheet labels it Cancelled and still shows its description and cancellation note.",
  },
  {
    id: "dense",
    label: "Dense feed / link hover",
    buttonLabel: "Show dense-feed link-hover title preview",
    questId: "q-9417",
    title: "Slide compact link details around dense feed controls",
    description:
      "Fine-pointer hover keeps the two-row compact preview visible by sliding it past nearby transition controls.",
  },
] as const;

const PREVIEW_FIXTURE_BY_ID = new Map(PREVIEW_FIXTURES.map((fixture) => [fixture.id, fixture] as const));
const PREVIEW_QUEST_BY_ID = new Map(
  PREVIEW_FIXTURES.map((fixture, fixtureIndex) => {
    const showsFullEstablishedPreview = fixture.id === "rich";
    if (fixture.id === "link-touch") return [fixture.questId, activeLinkTouchQuest(fixture)] as const;
    if (fixture.id === "cancelled") return [fixture.questId, cancelledQuest(fixture)] as const;
    const completedAt = 1_787_990_520_000 + fixtureIndex;
    const feedback = Array.from({ length: 5 }, (_, feedbackIndex) => ({
      author: (feedbackIndex === 4 ? "human" : "agent") as "human" | "agent",
      text:
        feedbackIndex === 4
          ? "Keep the exact feedback action primary while the parent quest remains a separately labelled action."
          : `Playground fixture feedback ${feedbackIndex}.`,
      ts: 1_787_990_400_000 + fixtureIndex * 10 + feedbackIndex,
    }));
    const quest = {
      id: `${fixture.questId}-v3`,
      questId: fixture.questId,
      version: 3,
      status: showsFullEstablishedPreview ? "done" : "refined",
      title: fixture.title,
      description: fixture.description,
      tldr: "A deterministic Playground fixture for the accepted chat-feed inline quest preview contract.",
      tags: ["ui", "implementation"],
      feedback,
      createdAt: 1_787_990_400_000,
      updatedAt: 1_787_990_460_000 + fixtureIndex,
      ...(showsFullEstablishedPreview
        ? {
            leaderSessionId: PREVIEW_LEADER_SESSION_ID,
            sessionId: PREVIEW_WORKER_SESSION_ID,
            claimedAt: 1_787_990_430_000,
          }
        : {}),
      ...(showsFullEstablishedPreview
        ? {
            completedAt,
            verificationItems: [],
            verificationInboxUnread: false,
            debrief:
              "Hovering the thread icon presents the established full quest preview without replacing native link behavior.",
            debriefTldr:
              "The established full preview stays available from the thread icon while native links, exact feedback, and non-blocking geometry remain intact.",
            journeyRuns: [
              {
                runId: "playground-completed-run",
                source: "board",
                phaseIds: ["alignment", "work", "memory"],
                status: "completed",
                createdAt: completedAt - 60_000,
                updatedAt: completedAt,
                completedAt,
                phaseOccurrences: [
                  {
                    occurrenceId: "playground-completed-run:p1",
                    phaseId: "alignment",
                    phaseIndex: 0,
                    phasePosition: 1,
                    phaseOccurrence: 1,
                    status: "completed",
                  },
                  {
                    occurrenceId: "playground-completed-run:p2",
                    phaseId: "work",
                    phaseIndex: 1,
                    phasePosition: 2,
                    phaseOccurrence: 1,
                    status: "completed",
                  },
                  {
                    occurrenceId: "playground-completed-run:p3",
                    phaseId: "memory",
                    phaseIndex: 2,
                    phasePosition: 3,
                    phaseOccurrence: 1,
                    status: "completed",
                  },
                ],
              },
            ],
          }
        : {}),
    } as QuestmasterTask;
    return [fixture.questId, quest] as const;
  }),
);

function activeLinkTouchQuest(fixture: PreviewFixtureDefinition): QuestmasterTask {
  return {
    id: `${fixture.questId}-v2`,
    questId: fixture.questId,
    version: 2,
    status: "in_progress",
    title: fixture.title,
    description: fixture.description,
    tldr: "Image thumbnails shown for local image paths in leader messages reload slowly every time the user sends a new message. Find out whether images are re-downloaded unnecessarily and fix it.",
    tags: ["ui", "bugfix"],
    leaderSessionId: PREVIEW_LEADER_SESSION_ID,
    sessionId: PREVIEW_WORKER_SESSION_ID,
    claimedAt: 1_787_990_430_000,
    createdAt: 1_787_990_400_000,
    updatedAt: 1_787_990_470_000,
    phasePreviewLines: [
      {
        label: "Work",
        metaLabel: "Work 1",
        text: "Thumbnails re-mount on every send because their keys change; keyed them by image path and confirmed one download per image.",
      },
    ],
  } as unknown as QuestmasterTask;
}

function cancelledQuest(fixture: PreviewFixtureDefinition): QuestmasterTask {
  return {
    id: `${fixture.questId}-v2`,
    questId: fixture.questId,
    version: 2,
    status: "done",
    cancelled: true,
    title: fixture.title,
    description:
      "Throwaway quest for a live check of the automatic User Checkpoint after the restart: a leader question in this thread should move the quest into User Checkpoint and back to Work when answered.",
    notes:
      "Passed: an open leader question moved the quest into User Checkpoint, and answering it returned the quest to Work.",
    tags: ["orchestration", "validation"],
    verificationItems: [],
    claimedAt: 1_787_990_430_000,
    completedAt: 1_787_990_520_000,
    createdAt: 1_787_990_400_000,
    updatedAt: 1_787_990_520_000,
  } as unknown as QuestmasterTask;
}

function restoreMapEntries<T>(current: ReadonlyMap<string, T>, previous: Map<string, { present: boolean; value?: T }>) {
  const restored = new Map(current);
  for (const [key, snapshot] of previous) {
    if (snapshot.present) restored.set(key, snapshot.value as T);
    else restored.delete(key);
  }
  return restored;
}

function useSeedPreviewFixtures(): boolean {
  const [seeded, setSeeded] = useState(false);

  useLayoutEffect(() => {
    const state = useStore.getState();
    const previousTitles = new Map<string, { present: boolean; value?: QuestTitlePreview | null }>();
    const questTitlePreviews = new Map(state.questTitlePreviews);
    const previousLeaderBoard = {
      present: state.sessionCompletedBoards.has(PREVIEW_LEADER_SESSION_ID),
      value: state.sessionCompletedBoards.get(PREVIEW_LEADER_SESSION_ID),
    };
    const sessionCompletedBoards = new Map(state.sessionCompletedBoards);
    sessionCompletedBoards.set(PREVIEW_LEADER_SESSION_ID, [
      {
        questId: PREVIEW_FIXTURE_BY_ID.get("rich")!.questId,
        title: PREVIEW_FIXTURE_BY_ID.get("rich")!.title,
        status: "MEMORY",
        updatedAt: 1_787_990_460_000,
        completedAt: 1_787_990_520_000,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
        },
      },
    ]);

    for (const [questId, quest] of PREVIEW_QUEST_BY_ID) {
      previousTitles.set(questId, {
        present: state.questTitlePreviews.has(questId),
        value: state.questTitlePreviews.get(questId),
      });
      questTitlePreviews.set(questId, {
        questId,
        title: quest.title,
        version: quest.version,
        updatedAt: quest.updatedAt,
      });
    }

    const linkTouchQuestId = PREVIEW_FIXTURE_BY_ID.get("link-touch")!.questId;
    // Quests with a leader name their Library topic under the title.
    seedLeaderTopics(PREVIEW_LEADER_SESSION_ID, {
      [linkTouchQuestId]: { id: "playground-topic-images", name: "Image previews" },
      [PREVIEW_FIXTURE_BY_ID.get("rich")!.questId]: { id: "playground-topic-links", name: "Quest links in the feed" },
    });
    const previousActiveBoard = {
      present: state.sessionBoards.has(PREVIEW_LEADER_SESSION_ID),
      value: state.sessionBoards.get(PREVIEW_LEADER_SESSION_ID),
    };
    const previousRowStatuses = {
      present: state.sessionBoardRowStatuses.has(PREVIEW_LEADER_SESSION_ID),
      value: state.sessionBoardRowStatuses.get(PREVIEW_LEADER_SESSION_ID),
    };
    const sessionBoards = new Map(state.sessionBoards);
    sessionBoards.set(PREVIEW_LEADER_SESSION_ID, [
      {
        questId: linkTouchQuestId,
        title: PREVIEW_FIXTURE_BY_ID.get("link-touch")!.title,
        status: "WORKING",
        worker: PREVIEW_WORKER_SESSION_ID,
        workerNum: 41,
        updatedAt: 1_787_990_470_000,
        journey: { mode: "active", phaseIds: ["work", "memory"], currentPhaseId: "work" },
      },
    ]);
    const sessionBoardRowStatuses = new Map(state.sessionBoardRowStatuses);
    sessionBoardRowStatuses.set(PREVIEW_LEADER_SESSION_ID, {
      [linkTouchQuestId]: {
        worker: { sessionId: PREVIEW_WORKER_SESSION_ID, sessionNum: 41, name: "Preview worker", status: "running" },
        reviewer: { sessionId: PREVIEW_REVIEWER_SESSION_ID, sessionNum: 42, name: "Preview reviewer", status: "idle" },
      },
    });
    useStore.setState({ questTitlePreviews, sessionCompletedBoards, sessionBoards, sessionBoardRowStatuses });
    setSeeded(true);

    return () => {
      useStore.setState((current) => {
        const restoredBoards = new Map(current.sessionCompletedBoards);
        if (previousLeaderBoard.present) {
          restoredBoards.set(PREVIEW_LEADER_SESSION_ID, previousLeaderBoard.value ?? []);
        } else {
          restoredBoards.delete(PREVIEW_LEADER_SESSION_ID);
        }
        const restoredActiveBoards = new Map(current.sessionBoards);
        if (previousActiveBoard.present)
          restoredActiveBoards.set(PREVIEW_LEADER_SESSION_ID, previousActiveBoard.value ?? []);
        else restoredActiveBoards.delete(PREVIEW_LEADER_SESSION_ID);
        const restoredRowStatuses = new Map(current.sessionBoardRowStatuses);
        if (previousRowStatuses.present)
          restoredRowStatuses.set(PREVIEW_LEADER_SESSION_ID, previousRowStatuses.value ?? {});
        else restoredRowStatuses.delete(PREVIEW_LEADER_SESSION_ID);
        return {
          questTitlePreviews: restoreMapEntries(current.questTitlePreviews, previousTitles),
          sessionCompletedBoards: restoredBoards,
          sessionBoards: restoredActiveBoards,
          sessionBoardRowStatuses: restoredRowStatuses,
        };
      });
    };
  }, []);

  return seeded;
}

/** Session buttons read numbers from sdkSessions, which session-list refreshes replace, so re-seed when missing. */
function useSeedPreviewSessions(): void {
  const seeded = useStore((state) =>
    PREVIEW_SESSIONS.every(({ sessionId }) => state.sdkSessions.some((session) => session.sessionId === sessionId)),
  );
  useEffect(() => {
    if (seeded) return;
    const fixtureSessionIds = new Set<string>(PREVIEW_SESSIONS.map((session) => session.sessionId));
    useStore.setState((state) => ({
      sdkSessions: [
        ...state.sdkSessions.filter((session) => !fixtureSessionIds.has(session.sessionId)),
        ...PREVIEW_SESSIONS.map(
          (session) =>
            ({
              ...session,
              state: session.sessionId === PREVIEW_WORKER_SESSION_ID ? "running" : "connected",
              cliConnected: true,
              cwd: "/playground",
              createdAt: 1_787_990_400_000,
            }) as SdkSessionInfo,
        ),
      ],
    }));
  }, [seeded]);
}

function dispatchTouchActivation(button: HTMLElement) {
  const pointerDown = new Event("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(pointerDown, "pointerType", {
    configurable: true,
    value: "touch",
  });
  button.dispatchEvent(pointerDown);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

function dispatchFinePointerEnter(element: HTMLElement) {
  // React synthesizes onPointerEnter from a bubbling pointerover event.
  const rect = element.getClientRects()[0] ?? element.getBoundingClientRect();
  const pointerOver = new Event("pointerover", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(pointerOver, {
    pointerType: { configurable: true, value: "mouse" },
    clientX: { configurable: true, value: rect.left + rect.width / 2 },
    clientY: { configurable: true, value: rect.top + rect.height / 2 },
  });
  element.dispatchEvent(pointerOver);
}

function dispatchKeyboardActivation(button: HTMLButtonElement) {
  button.focus({ preventScroll: true });
  button.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }),
  );
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
}

function LivePreviewFixture({ state, revision }: { state: PreviewFixtureState; revision: number }) {
  const fixture = PREVIEW_FIXTURE_BY_ID.get(state)!;
  const rootRef = useRef<HTMLDivElement>(null);
  const loadQuest = useCallback(async (questId: string) => {
    if (questId === PREVIEW_FIXTURE_BY_ID.get("error")!.questId) {
      throw new Error("Playground fixture: by-ID quest preview request failed.");
    }
    return PREVIEW_QUEST_BY_ID.get(questId) ?? null;
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled || !rootRef.current) return;
      const link = rootRef.current.querySelector<HTMLAnchorElement>("a.cc-quest-link");
      const preview = rootRef.current.querySelector<HTMLButtonElement>("[data-testid='quest-feed-preview-button']");
      if (!link || !preview) return;

      if (state === "title" || state === "no-fit") {
        link.focus({ preventScroll: true });
        return;
      }
      if (state === "dense") {
        dispatchFinePointerEnter(link);
        return;
      }
      if (state === "coarse") {
        preview.classList.add("cc-feed-quest-preview-trigger-force-coarse");
        dispatchTouchActivation(preview);
        return;
      }
      if (state === "link-touch" || state === "cancelled") {
        dispatchTouchActivation(link);
        return;
      }
      if (state === "keyboard") {
        dispatchKeyboardActivation(preview);
        return;
      }
      dispatchFinePointerEnter(preview);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [revision, state]);

  // The link-tap fixture links the whole quest, as most message links do; the others keep an exact feedback target.
  const feedbackIndex = state === "link-touch" || state === "cancelled" ? undefined : 4;
  const wrappedLabel =
    state === "no-fit"
      ? `${fixture.questId} feedback #4 with a deliberately long wrapped exact-target label`
      : feedbackIndex === undefined
        ? fixture.questId
        : `${fixture.questId} feedback #4`;
  const exactTarget = (
    <>
      Review{" "}
      <QuestFeedInlineLink
        questId={fixture.questId}
        feedbackIndex={feedbackIndex}
        className="cc-quest-link break-words hover:underline"
        stopPropagation={false}
        loadQuest={loadQuest}
      >
        {wrappedLabel}
      </QuestFeedInlineLink>
      <span aria-hidden="true">, then continue with the adjacent prose.</span>
    </>
  );
  const geometryControl = (position: "above" | "before" | "after" | "below") => (
    <button
      type="button"
      tabIndex={-1}
      data-preview-geometry-exclusion={position}
      className={`h-full w-full rounded border border-dashed border-cc-border bg-cc-bg/80 px-2 py-1 text-[10px] leading-tight text-cc-muted ${
        state === "no-fit" ? (position === "above" || position === "below" ? "min-h-20" : "min-h-36") : ""
      }`}
    >
      Dense neighbor {position}
    </button>
  );

  return (
    <div
      key={`${state}-${revision}`}
      ref={rootRef}
      className="message-feed-scroll-surface relative rounded-lg border border-cc-border/70 bg-cc-bg p-4 text-sm leading-relaxed"
      data-message-id={`playground-inline-preview-${state}`}
      data-testid="playground-inline-quest-preview-live"
      data-preview-fixture-state={state}
    >
      <p className="mb-3 text-xs text-cc-muted" data-testid="playground-inline-quest-preview-description">
        {fixture.description}
      </p>
      {state === "no-fit" ? (
        <div className="grid max-w-[34rem] grid-cols-[5rem_minmax(0,15rem)_5rem] gap-1">
          <div className="col-span-3">{geometryControl("above")}</div>
          {geometryControl("before")}
          <div>{exactTarget}</div>
          {geometryControl("after")}
          <div className="col-span-3">{geometryControl("below")}</div>
        </div>
      ) : state === "dense" ? (
        <div className="max-w-[38rem] space-y-1">
          <div className="flex justify-center gap-2">
            <div className="w-44">{geometryControl("above")}</div>
            <div className="w-20">{geometryControl("before")}</div>
          </div>
          <div className="pl-24">{exactTarget}</div>
          <div className="flex justify-center gap-2">
            <div className="w-20">{geometryControl("after")}</div>
            <div className="w-[24rem]">{geometryControl("below")}</div>
          </div>
        </div>
      ) : (
        <div>{exactTarget}</div>
      )}
      {state === "no-fit" && (
        <div
          role="status"
          data-testid="playground-inline-quest-preview-no-fit-status"
          className="mt-3 rounded-md border border-dashed border-cc-border px-2.5 py-2 text-xs text-cc-muted"
        >
          No legal title placement: the optional title layer is omitted while the exact anchor and eye remain live.
        </div>
      )}
    </div>
  );
}

function ScopeBoundaryFixture() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div
        className="message-feed-scroll-surface rounded-lg border border-cc-border/70 bg-cc-bg p-3 text-sm"
        data-message-id="playground-parsed-feed-link"
        data-testid="playground-inline-quest-preview-feed-boundary"
      >
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-cc-muted/70">Parsed chat feed</div>
        <div className="max-w-[13rem]" data-testid="playground-inline-quest-preview-narrow-wrap">
          <MarkdownContent
            text="Narrow lead-in keeps [q-9410 feedback #4](quest:q-9410:feedback:4) together before the next words."
            questLinkSurface="chat-feed"
          />
        </div>
      </div>
      <div
        className="rounded-lg border border-cc-border/70 bg-cc-bg p-3 text-sm"
        data-testid="playground-inline-quest-preview-legacy-boundary"
      >
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-cc-muted/70">
          Same parsed non-feed link
        </div>
        <MarkdownContent text="[q-9410 feedback #4](quest:q-9410:feedback:4)" />
      </div>
    </div>
  );
}

function ColorParityFixture() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div
        className="message-feed-scroll-surface rounded-lg border border-cc-border/70 bg-cc-bg p-3 text-sm"
        data-message-id="playground-blue-quest-link"
        data-testid="playground-inline-quest-preview-blue-color"
      >
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-cc-muted/70">Standard feed link</div>
        <MarkdownContent text="[q-9410](quest:q-9410)" questLinkSurface="chat-feed" />
      </div>
      <div className="max-w-[15rem]" data-testid="playground-inline-quest-preview-orange-color">
        <QuestQuizSection
          variant="inline"
          questId="q-9410"
          questTitle="Inline quiz link"
          questLinkSurface="chat-feed"
          items={[
            {
              id: "playground-color-parity",
              question: "What should the adjacent eye match?",
              answer: "The exact rendered color of this orange quest link.",
            },
          ]}
        />
      </div>
    </div>
  );
}

export function PlaygroundInlineQuestPreviewSection() {
  const seeded = useSeedPreviewFixtures();
  useSeedPreviewSessions();
  const [selection, setSelection] = useState<{
    state: PreviewFixtureState;
    revision: number;
  }>({
    state: "idle",
    revision: 0,
  });
  const selectedFixture = PREVIEW_FIXTURE_BY_ID.get(selection.state)!;

  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Inline Quest Preview"
        description="Chat-feed-only quest links keep native navigation and a jump-to-thread icon in one cohesive fixed-gap unit: clicking the icon opens the quest's leader thread, hovering it previews. Select any state to drive the real compact and rich preview behavior deterministically."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <Card label="Deterministic state controls">
            <div
              role="group"
              aria-label="Inline quest preview fixture state"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {PREVIEW_FIXTURES.map((fixture) => (
                <button
                  key={fixture.id}
                  type="button"
                  aria-label={fixture.buttonLabel}
                  aria-pressed={selection.state === fixture.id}
                  data-testid={`playground-inline-quest-preview-state-${fixture.id}`}
                  onClick={() =>
                    setSelection((current) => ({
                      state: fixture.id,
                      revision: current.revision + 1,
                    }))
                  }
                  className={`min-h-10 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    selection.state === fixture.id
                      ? "border-cc-primary/45 bg-cc-primary/10 text-cc-fg"
                      : "border-cc-border bg-cc-bg text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
                  }`}
                >
                  <span className="font-medium">{fixture.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-cc-muted">
              Re-selecting a state resets its instance, timers, focus, and preview surface for repeatable browser
              checks.
            </p>
          </Card>

          <Card label={`Live component — ${selectedFixture.label}`}>
            {seeded ? (
              <LivePreviewFixture state={selection.state} revision={selection.revision} />
            ) : (
              <div role="status" className="rounded-lg bg-cc-bg p-4 text-xs text-cc-muted">
                Seeding deterministic quest preview fixtures…
              </div>
            )}
          </Card>

          <div className="xl:col-span-2">
            <Card label="Fixed adjacency and scope boundary — real parsed Markdown">
              <ScopeBoundaryFixture />
              <p className="mt-3 text-xs text-cc-muted">
                The narrow feed fixture keeps the link and icon together while surrounding prose wraps. Only the
                explicit chat-feed producer adds the icon; the adjacent non-feed surface keeps legacy behavior.
              </p>
            </Card>
          </div>

          <div className="xl:col-span-2">
            <Card label="Fixed quiz adjacency and link-color parity">
              <ColorParityFixture />
              <p className="mt-3 text-xs text-cc-muted">
                Each icon remains fixed beside its anchor and derives that exact rendered color: standard feed links
                stay blue, while the constrained inline quiz link and icon stay orange.
              </p>
            </Card>
          </div>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
