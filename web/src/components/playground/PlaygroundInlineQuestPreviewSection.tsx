import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QuestmasterTask, QuestTitlePreview } from "../../types.js";
import { useStore } from "../../store.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { QuestFeedInlineLink } from "../QuestFeedInlineLink.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

type PreviewFixtureState = "idle" | "title" | "no-fit" | "rich" | "error" | "coarse";

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
    description: "The exact anchor and its adjacent Preview control are both present before any interaction.",
  },
  {
    id: "title",
    label: "Title micro-preview",
    buttonLabel: "Show title micro-preview",
    questId: "q-9411",
    title: "Dock a pointer-inert title beside the stable Preview control",
    description: "Keyboard focus reveals the real title-only layer without opening rich content or moving focus.",
  },
  {
    id: "no-fit",
    label: "Wrapped / no-fit",
    buttonLabel: "Show wrapped no-fit state",
    questId: "q-9412",
    title: "Keep the wrapped exact link usable when no title placement is legal",
    description: "A deterministic dense-control exclusion makes the real title layer report no-fit and stay hidden.",
  },
  {
    id: "rich",
    label: "Explicit rich preview",
    buttonLabel: "Show rich preview",
    questId: "q-9413",
    title: "Open rich quest context only after explicit Preview activation",
    description: "The real component hydrates a local by-ID fixture and opens its labelled nonmodal desktop surface.",
  },
  {
    id: "error",
    label: "Rich hydration error",
    buttonLabel: "Show rich error state",
    questId: "q-9414",
    title: "Retain exact navigation when rich preview hydration fails",
    description:
      "The local loader rejects deterministically so Retry, direct navigation, and Close remain inspectable.",
  },
  {
    id: "coarse",
    label: "Coarse pointer",
    buttonLabel: "Show coarse-pointer sheet",
    questId: "q-9415",
    title: "Use a separate touch target and an explicitly activated bottom sheet",
    description:
      "A synthetic touch activation opens the real modal sheet and forces the 44 px Playground target style.",
  },
] as const;

const PREVIEW_FIXTURE_BY_ID = new Map(PREVIEW_FIXTURES.map((fixture) => [fixture.id, fixture] as const));
const PREVIEW_QUEST_BY_ID = new Map(
  PREVIEW_FIXTURES.map((fixture, fixtureIndex) => {
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
      status: "refined",
      title: fixture.title,
      description: fixture.description,
      tldr: "A deterministic Playground fixture for the accepted chat-feed inline quest preview contract.",
      tags: ["ui", "implementation"],
      feedback,
      createdAt: 1_787_990_400_000,
      updatedAt: 1_787_990_460_000 + fixtureIndex,
    } as QuestmasterTask;
    return [fixture.questId, quest] as const;
  }),
);

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

    useStore.setState({ questTitlePreviews });
    setSeeded(true);

    return () => {
      useStore.setState((current) => ({
        questTitlePreviews: restoreMapEntries(current.questTitlePreviews, previousTitles),
      }));
    };
  }, []);

  return seeded;
}

function dispatchTouchActivation(button: HTMLButtonElement) {
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
      if (state === "coarse") {
        preview.classList.add("cc-feed-quest-preview-trigger-force-coarse");
        dispatchTouchActivation(preview);
        return;
      }
      preview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [revision, state]);

  const wrappedLabel =
    state === "no-fit"
      ? `${fixture.questId} feedback #4 with a deliberately long wrapped exact-target label`
      : `${fixture.questId} feedback #4`;

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
      <div className={state === "no-fit" ? "max-w-[15rem]" : undefined}>
        Review{" "}
        <QuestFeedInlineLink
          questId={fixture.questId}
          feedbackIndex={4}
          className="cc-quest-link break-words hover:underline"
          stopPropagation={false}
          loadQuest={loadQuest}
        >
          {wrappedLabel}
        </QuestFeedInlineLink>
        <span aria-hidden="true">, then continue with the adjacent prose.</span>
      </div>
      {state === "no-fit" && (
        <div
          role="status"
          data-testid="playground-inline-quest-preview-no-fit-status"
          className="mt-3 rounded-md border border-dashed border-cc-border px-2.5 py-2 text-xs text-cc-muted"
        >
          No legal title placement: the optional title layer is omitted while the exact anchor and Preview remain live.
        </div>
      )}
      {state === "no-fit" && (
        <button
          type="button"
          inert
          tabIndex={-1}
          data-testid="playground-inline-quest-preview-geometry-exclusion"
          className="pointer-events-none fixed inset-0 -z-10 h-screen w-screen opacity-0"
        >
          Deterministic geometry exclusion
        </button>
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
        <MarkdownContent text="[q-9410 feedback #4](quest:q-9410:feedback:4)" questLinkSurface="chat-feed" />
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

export function PlaygroundInlineQuestPreviewSection() {
  const seeded = useSeedPreviewFixtures();
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
        description="Chat-feed-only quest links keep native navigation, add a stable Preview control, and reserve rich content for explicit activation. Select any state to drive the real component deterministically."
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
            <Card label="Scope boundary — real parsed Markdown">
              <ScopeBoundaryFixture />
              <p className="mt-3 text-xs text-cc-muted">
                Only the explicit chat-feed producer adds Preview. The same shared Markdown link keeps legacy behavior
                in the adjacent non-feed surface.
              </p>
            </Card>
          </div>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
