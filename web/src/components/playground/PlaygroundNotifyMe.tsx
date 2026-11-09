import { useState } from "react";
import { NotifyMeControlView, NotifyMeIcon } from "../NotifyMe.js";
import { Card } from "./shared.js";

const STRIP_BUTTON_CLASS =
  "inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 rounded-md px-0.5 text-[11px]";

export function PlaygroundNotifyMe() {
  const [enabled, setEnabled] = useState(true);
  const [pending, setPending] = useState(true);
  return (
    <Card label="Notify Me: tab control, acknowledge first">
      <div className="space-y-3 p-3" data-testid="playground-notify-me">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-t-lg border border-cc-border px-2 py-1 text-xs text-cc-fg">
            {enabled && <NotifyMeIcon pending={pending} />}Compare navigation designs
          </span>
          <NotifyMeControlView
            enabled={enabled}
            pending={enabled && pending}
            onOpen={() => {
              setEnabled(!enabled);
              setPending(false);
            }}
            onAcknowledge={() => setPending(false)}
          />
        </div>
        {/* A thread's strip and the quest views' bordered button, off and on side by side: on is a
            tinted pill with a filled target, so the state shows without hovering. */}
        <div
          className="flex flex-wrap items-center gap-3 text-[11px] text-cc-muted"
          data-testid="playground-notify-me-states"
        >
          {[false, true].map((on) => (
            <span key={String(on)} className="inline-flex items-center gap-1.5">
              {on ? "On" : "Off"}
              <NotifyMeControlView
                enabled={on}
                pending={false}
                iconOnly
                className={STRIP_BUTTON_CLASS}
                onOpen={() => {}}
                onAcknowledge={() => {}}
              />
              <NotifyMeControlView
                enabled={on}
                pending={false}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium"
                onOpen={() => {}}
                onAcknowledge={() => {}}
              />
            </span>
          ))}
        </div>
        {/* A reminder set on a thread's strip: the icon button widens to say when, on one line. */}
        <div className="flex h-8 max-w-sm items-center gap-1.5 border-b border-cc-border/80 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium text-cc-fg">
            q-2944 Rebase the seeded-QA pipeline PR and fix regressions
          </span>
          <NotifyMeControlView
            enabled={false}
            pending={false}
            reminderAt={Date.now() + 2 * 24 * 60 * 60 * 1000}
            iconOnly
            className={STRIP_BUTTON_CLASS}
            onOpen={() => {}}
            onAcknowledge={() => {}}
          />
        </div>
        <button
          type="button"
          className="text-xs text-cc-info hover:underline cursor-pointer"
          onClick={() => {
            setEnabled(true);
            setPending(true);
          }}
        >
          Show a new Ready result
        </button>
      </div>
    </Card>
  );
}
