import { useRef } from "react";
import { UserMessageNavigator } from "../UserMessageNavigator.js";
import type { UserNavigationTarget } from "../message-feed-user-navigation.js";
import { Card, Section } from "./shared.js";

const PLAYGROUND_NAV_TARGETS: UserNavigationTarget[] = [
  {
    key: "turn:user-nav-1",
    turnId: "user-nav-1",
    blockId: "turn:user-nav-1",
    messageId: "user-nav-1",
    content: "Review the thread navigation controls and keep the composer reachable on mobile.",
    timestamp: Date.now() - 420_000,
  },
  {
    key: "turn:user-nav-2",
    turnId: "user-nav-2",
    blockId: "turn:user-nav-2",
    messageId: "user-nav-2",
    content: "Find the worker handoff where the implementation notes mention current-tab scoping.",
    timestamp: Date.now() - 260_000,
  },
  {
    key: "turn:user-nav-3",
    turnId: "user-nav-3",
    blockId: "turn:user-nav-3",
    messageId: "user-nav-3",
    content: "Jump back to the approval question before sending the final summary.",
    timestamp: Date.now() - 90_000,
  },
];

export function PlaygroundUserMessageNavigatorSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  const touchContainerRef = useRef<HTMLDivElement>(null);
  const touchContentRootRef = useRef<HTMLDivElement>(null);
  const navButtonClassName =
    "h-8 w-8 rounded-full bg-cc-card border border-cc-border shadow-lg flex items-center justify-center text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-all";
  const touchNavButtonClassName =
    "h-10 w-10 rounded-full bg-cc-card border border-cc-border shadow-lg flex items-center justify-center text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-all";

  return (
    <Section
      title="User Message Navigator"
      description="Compact current/total user-message selector with searchable truncated previews."
    >
      <Card label="Expanded selector beside existing feed navigation">
        <div className="relative h-[300px] overflow-hidden border-t border-cc-border bg-cc-bg">
          <div ref={containerRef} className="h-full overflow-y-auto px-4 py-5" data-testid="playground-user-nav-feed">
            <div ref={contentRootRef} className="max-w-2xl space-y-8">
              {PLAYGROUND_NAV_TARGETS.map((target) => (
                <div
                  key={target.key}
                  data-feed-block-id={target.blockId}
                  className="max-w-[76%] rounded-lg bg-cc-user px-3 py-2 text-sm text-cc-fg"
                >
                  {target.content}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute bottom-4 right-4 flex flex-col gap-4">
            <button type="button" className={navButtonClassName} aria-label="Go to top">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M4 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 12h8" strokeLinecap="round" />
              </svg>
            </button>
            <UserMessageNavigator
              sessionId="playground-user-message-navigator"
              currentThreadKey="main"
              isLeaderSession={false}
              useServerSearch={false}
              isTouch={false}
              containerRef={containerRef}
              contentRootRef={contentRootRef}
              targets={PLAYGROUND_NAV_TARGETS}
              visibleWindowSignature="playground-user-message-navigator"
              buttonClassName={navButtonClassName}
              defaultOpen
              onPrevious={() => {}}
              onNext={() => {}}
              onSelectTarget={() => {}}
            />
            <button type="button" className={navButtonClassName} aria-label="Go to bottom">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M4 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 4h8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </Card>
      <Card label="Mobile touch selector with fixed solid overlay">
        <div className="relative h-[300px] overflow-hidden border-t border-cc-border bg-cc-bg">
          <div
            ref={touchContainerRef}
            className="h-full overflow-y-auto px-4 py-5"
            data-testid="playground-user-nav-mobile-feed"
          >
            <div ref={touchContentRootRef} className="space-y-8">
              {PLAYGROUND_NAV_TARGETS.map((target) => (
                <div
                  key={target.key}
                  data-feed-block-id={target.blockId}
                  className="max-w-[88%] rounded-lg bg-cc-user px-3 py-2 text-sm text-cc-fg"
                >
                  {target.content}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 opacity-60">
            <button type="button" className={touchNavButtonClassName} aria-label="Mobile go to top">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M4 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 12h8" strokeLinecap="round" />
              </svg>
            </button>
            <UserMessageNavigator
              sessionId="playground-user-message-navigator-mobile"
              currentThreadKey="main"
              isLeaderSession={false}
              useServerSearch={false}
              isTouch
              containerRef={touchContainerRef}
              contentRootRef={touchContentRootRef}
              targets={PLAYGROUND_NAV_TARGETS}
              visibleWindowSignature="playground-user-message-navigator-mobile"
              buttonClassName={touchNavButtonClassName}
              defaultOpen
              onPrevious={() => {}}
              onNext={() => {}}
              onSelectTarget={() => {}}
            />
            <button type="button" className={touchNavButtonClassName} aria-label="Mobile go to bottom">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M4 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 4h8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </Card>
    </Section>
  );
}
