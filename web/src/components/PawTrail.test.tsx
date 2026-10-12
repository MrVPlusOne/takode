// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { _resetLiveAnswerArrivalsForTest, recordLiveAnswerArrival } from "../utils/live-answer-arrivals.js";
import { PawTrailAvatar, PawTrailProvider } from "./PawTrail.js";

// The provider writes each paw's state to data-paw-state after mounts settle
// (one microtask after the commit); CSS draws the paw, dot and animations.

function Feed({
  ids,
  scopeKey = "s1:main",
  showNewestPaw = true,
}: {
  ids: string[];
  scopeKey?: string;
  showNewestPaw?: boolean;
}) {
  return (
    <PawTrailProvider scopeKey={scopeKey} showNewestPaw={showNewestPaw}>
      {ids.map((id) => (
        <div key={id} data-testid={`row-${id}`}>
          <PawTrailAvatar messageId={id} />
        </div>
      ))}
    </PawTrailProvider>
  );
}

async function renderFeed(props: Parameters<typeof Feed>[0]) {
  const view = render(<Feed {...props} />);
  await settle();
  return {
    ...view,
    rerenderFeed: async (next: Parameters<typeof Feed>[0]) => {
      view.rerender(<Feed {...next} />);
      await settle();
    },
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function pawStates(container: HTMLElement): Record<string, string | null> {
  const states: Record<string, string | null> = {};
  for (const row of container.querySelectorAll<HTMLElement>("[data-testid^='row-']")) {
    const paw = row.querySelector<HTMLElement>(".paw-trail");
    states[row.dataset.testid!.slice(4)] = paw?.dataset.pawState ?? null;
  }
  return states;
}

beforeEach(() => {
  _resetLiveAnswerArrivalsForTest();
});

describe("PawTrailProvider", () => {
  it("shows the newest answer's paw at rest and every other answer as a dot", async () => {
    const { container } = await renderFeed({ ids: ["a1", "a2", "a3"] });
    expect(pawStates(container)).toEqual({ a1: null, a2: null, a3: "paw" });
  });

  it("lands a live answer's paw once and settles the previous newest paw", async () => {
    // The paw walks down the feed: the new answer lands, the old one becomes a dot.
    const { container, rerenderFeed } = await renderFeed({ ids: ["a1", "a2"] });
    recordLiveAnswerArrival("a3");
    await rerenderFeed({ ids: ["a1", "a2", "a3"] });
    expect(pawStates(container)).toEqual({ a1: null, a2: "settling", a3: "landing" });

    // Remounting the same answer (for example when its turn collapses) must not replay.
    await rerenderFeed({ ids: ["a1", "a2"] });
    await rerenderFeed({ ids: ["a1", "a2", "a3"] });
    expect(pawStates(container).a3).toBe("paw");
  });

  it("does not land answers that arrived before the view opened", async () => {
    recordLiveAnswerArrival("a2");
    const { container } = await renderFeed({ ids: ["a1", "a2"] });
    expect(pawStates(container)).toEqual({ a1: null, a2: "paw" });
  });

  it("treats a thread switch as opening a new view", async () => {
    const { container, rerenderFeed } = await renderFeed({ ids: ["a1"], scopeKey: "s1:main" });
    // Arrived for another thread while this one was shown.
    recordLiveAnswerArrival("b2");
    await rerenderFeed({ ids: ["b1", "b2"], scopeKey: "s1:q-1" });
    expect(pawStates(container)).toEqual({ b1: null, b2: "paw" });
  });

  it("leaves the newest paw alone when older history loads above it", async () => {
    const { container, rerenderFeed } = await renderFeed({ ids: ["a3", "a4"] });
    recordLiveAnswerArrival("a1");
    await rerenderFeed({ ids: ["a1", "a2", "a3", "a4"] });
    expect(pawStates(container)).toEqual({ a1: null, a2: null, a3: null, a4: "paw" });
  });

  it("shows only dots while the newest history is not loaded", async () => {
    const { container, rerenderFeed } = await renderFeed({ ids: ["a1", "a2"] });
    await rerenderFeed({ ids: ["a1", "a2"], showNewestPaw: false });
    expect(pawStates(container)).toEqual({ a1: null, a2: "dot" });
  });

  it("renders a dot without a provider", () => {
    const { container } = render(<PawTrailAvatar messageId="a1" />);
    expect(container.querySelector<HTMLElement>(".paw-trail")?.dataset.pawState).toBeUndefined();
  });
});
