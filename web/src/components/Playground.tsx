import { useEffect, useRef, useState } from "react";
import { COLOR_THEMES, isDarkTheme, useStore, type ColorTheme } from "../store.js";
import {
  navigateToMostRecentSession,
  navigateToSession,
  playgroundSectionIdFromHash,
  withPlaygroundSectionInHash,
} from "../utils/routing.js";
import { PlaygroundOverviewSections } from "./playground/sections-overview.js";
import { PlaygroundInteractiveSections } from "./playground/sections-interactive.js";
import { PlaygroundStateSections } from "./playground/sections-states.js";
import {
  DEFAULT_PLAYGROUND_SECTION_ID,
  PLAYGROUND_NAV_GROUPS,
  PLAYGROUND_NAV_ITEM_IDS,
  type PlaygroundNavGroup,
} from "./playground/navigation.js";
import { usePlaygroundSeed } from "./playground/usePlaygroundSeed.js";

function getPlaygroundHashSectionId() {
  if (typeof window === "undefined") {
    return DEFAULT_PLAYGROUND_SECTION_ID;
  }

  const sectionId = playgroundSectionIdFromHash(window.location.hash);
  return sectionId && PLAYGROUND_NAV_ITEM_IDS.has(sectionId) ? sectionId : DEFAULT_PLAYGROUND_SECTION_ID;
}

function PlaygroundGroupBlock({
  group,
  children,
}: {
  group: PlaygroundNavGroup;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`playground-group-${group.id}-heading`} className="space-y-8">
      <div className="rounded-2xl border border-cc-border bg-cc-card/70 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cc-muted">{group.title}</p>
            <h2 id={`playground-group-${group.id}-heading`} className="mt-1 text-lg font-semibold text-cc-fg">
              {group.description}
            </h2>
          </div>
          <span className="rounded-full border border-cc-border bg-cc-hover px-2.5 py-1 text-[11px] text-cc-muted">
            {group.items.length} sections
          </span>
        </div>
      </div>
      {children}
    </section>
  );
}

export function Playground() {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => useStore.getState().colorTheme);
  const [activeSectionId, setActiveSectionId] = useState(getPlaygroundHashSectionId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const darkMode = isDarkTheme(colorTheme);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", darkMode);
    el.className = el.className.replace(/\btheme-\S+/g, "").trim();
    if (colorTheme !== "light" && colorTheme !== "dark") {
      el.classList.add(`theme-${colorTheme}`);
    }
    // Keep the store in sync so other components see the playground override
    useStore.getState().setColorTheme(colorTheme);
  }, [colorTheme, darkMode]);

  usePlaygroundSeed();

  function scrollToSection(sectionId: string, behavior: ScrollBehavior = "smooth") {
    document.getElementById(sectionId)?.scrollIntoView({ behavior, block: "start" });
  }

  useEffect(() => {
    const handleHashChange = () => {
      const nextSectionId = getPlaygroundHashSectionId();
      setActiveSectionId(nextSectionId);
      const requestedSectionId = playgroundSectionIdFromHash(window.location.hash);
      if (requestedSectionId && PLAYGROUND_NAV_ITEM_IDS.has(requestedSectionId)) {
        requestAnimationFrame(() => scrollToSection(nextSectionId, "auto"));
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const root = scrollContainerRef.current;
    if (!root) {
      return;
    }

    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-playground-section-id]"));
    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio - a.intersectionRatio || Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top),
          );
        const nextSectionId = visibleEntries[0]?.target.getAttribute("data-playground-section-id");
        if (nextSectionId && PLAYGROUND_NAV_ITEM_IDS.has(nextSectionId)) {
          setActiveSectionId(nextSectionId);
        }
      },
      {
        root,
        rootMargin: "-96px 0px -62% 0px",
        threshold: [0.15, 0.35, 0.6],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  function jumpToSection(sectionId: string) {
    setActiveSectionId(sectionId);
    const nextHash = withPlaygroundSectionInHash(window.location.hash || "#/playground", sectionId);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
    scrollToSection(sectionId, "smooth");
  }

  return (
    <div ref={scrollContainerRef} className="h-screen overflow-y-auto bg-cc-bg text-cc-fg font-sans-ui">
      <header className="sticky top-0 z-50 bg-cc-sidebar border-b border-cc-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold text-cc-fg tracking-tight">Component Playground</h1>
            <p className="text-xs text-cc-muted mt-0.5">Visual catalog of all UI components</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const sessionId = useStore.getState().currentSessionId;
                if (sessionId) {
                  navigateToSession(sessionId);
                } else {
                  navigateToMostRecentSession();
                }
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cc-hover hover:bg-cc-active text-cc-fg border border-cc-border transition-colors cursor-pointer"
            >
              Back to App
            </button>
            <div className="hidden items-center gap-1.5 md:flex">
              {COLOR_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setColorTheme(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    colorTheme === t.id
                      ? "bg-cc-primary/20 text-cc-primary border-cc-primary/30"
                      : "bg-cc-hover text-cc-muted border-cc-border hover:bg-cc-active hover:text-cc-fg"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="self-start lg:sticky lg:top-[5.5rem]">
            <nav
              aria-label="Playground navigation"
              className="overflow-hidden rounded-2xl border border-cc-border bg-cc-card/80 backdrop-blur"
            >
              <div className="border-b border-cc-border px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cc-muted">Navigation</p>
                <h2 className="mt-1 text-sm font-semibold text-cc-fg">Jump directly to the component state you need.</h2>
              </div>
              <div className="max-h-[calc(100vh-9rem)] space-y-4 overflow-y-auto px-3 py-3">
                {PLAYGROUND_NAV_GROUPS.map((group) => (
                  <section key={group.id} aria-labelledby={`playground-nav-group-${group.id}`}>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h3
                        id={`playground-nav-group-${group.id}`}
                        className="text-[11px] font-medium uppercase tracking-[0.18em] text-cc-muted"
                      >
                        {group.title}
                      </h3>
                      <span className="text-[11px] text-cc-muted">{group.items.length}</span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const isActive = activeSectionId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => jumpToSection(item.id)}
                            aria-current={isActive ? "true" : undefined}
                            className={`flex w-full items-start rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                              isActive
                                ? "bg-cc-primary/15 text-cc-primary"
                                : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
                            }`}
                          >
                            {item.title}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </nav>
          </aside>

          <main className="space-y-12">
            <PlaygroundGroupBlock group={PLAYGROUND_NAV_GROUPS[0]}>
              <PlaygroundOverviewSections />
            </PlaygroundGroupBlock>
            <PlaygroundGroupBlock group={PLAYGROUND_NAV_GROUPS[1]}>
              <PlaygroundInteractiveSections />
            </PlaygroundGroupBlock>
            <PlaygroundGroupBlock group={PLAYGROUND_NAV_GROUPS[2]}>
              <PlaygroundStateSections />
            </PlaygroundGroupBlock>
          </main>
        </div>
      </div>
    </div>
  );
}
