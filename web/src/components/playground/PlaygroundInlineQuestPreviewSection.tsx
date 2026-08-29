import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QuestmasterTask, QuestTitlePreview } from "../../types.js";
import { useStore } from "../../store.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { QuestFeedInlineLink } from "../QuestFeedInlineLink.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

type PreviewFixtureState = "idle" | "title" | "no-fit" | "rich" | "error" | "keyboard" | "coarse";

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
    description: "The exact anchor and its adjacent icon-only eye are both present before any interaction.",
  },
  {
    id: "title",
    label: "Link focus / title",
    buttonLabel: "Show link-focus title preview",
    questId: "q-9411",
    title: "Keep link focus limited to the title-only preview",
    description:
      "Keyboard focus on the native text link reveals only its pointer-inert title layer; the eye stays separate.",
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
    label: "Eye hover / rich",
    buttonLabel: "Show fine-pointer eye-hover details",
    questId: "q-9413",
    title: "Reveal rich quest context from the integrated eye",
    description:
      "Fine-pointer entry on the eye hydrates the local by-ID fixture and opens its labelled nonmodal surface.",
  },
  {
    id: "error",
    label: "Eye hover / error",
    buttonLabel: "Show eye-hover hydration error",
    questId: "q-9414",
    title: "Retain exact navigation when eye details fail to hydrate",
    description:
      "Eye hover drives a deterministic loader rejection so Retry, direct navigation, and Close remain inspectable.",
  },
  {
    id: "keyboard",
    label: "Eye keyboard action",
    buttonLabel: "Show keyboard-activated eye details",
    questId: "q-9415",
    title: "Open rich quest context from an explicit eye keyboard action",
    description: "The eye receives focus without opening a title layer, then Enter opens the labelled rich surface.",
  },
  {
    id: "coarse",
    label: "First touch / sheet",
    buttonLabel: "Show first-touch modal sheet",
    questId: "q-9416",
    title: "Use a separate eye touch target and a modal bottom sheet",
    description:
      "A first-touch eye activation opens the real modal sheet and forces the 44 px Playground target style.",
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

function dispatchFinePointerEnter(button: HTMLButtonElement) {
  // React synthesizes onPointerEnter from a bubbling pointerover event.
  const pointerOver = new Event("pointerover", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(pointerOver, {
    pointerType: { configurable: true, value: "mouse" },
    clientX: { configurable: true, value: 280 },
    clientY: { configurable: true, value: 210 },
  });
  button.dispatchEvent(pointerOver);
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
      if (state === "coarse") {
        preview.classList.add("cc-feed-quest-preview-trigger-force-coarse");
        dispatchTouchActivation(preview);
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

  const wrappedLabel =
    state === "no-fit"
      ? `${fixture.questId} feedback #4 with a deliberately long wrapped exact-target label`
      : `${fixture.questId} feedback #4`;
  const exactTarget = (
    <>
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
    </>
  );
  const geometryControl = (position: "above" | "before" | "after" | "below") => (
    <button
      type="button"
      tabIndex={-1}
      data-preview-geometry-exclusion="true"
      className="h-full w-full rounded border border-dashed border-cc-border bg-cc-bg/80 px-2 py-1 text-[10px] leading-tight text-cc-muted"
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
        description="Chat-feed-only quest links keep native navigation, show title-only link hover/focus, and put rich details behind a small adjacent eye. Select any state to drive the real component deterministically."
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
                Only the explicit chat-feed producer adds the eye. The same shared Markdown link keeps legacy behavior
                in the adjacent non-feed surface.
              </p>
            </Card>
          </div>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
