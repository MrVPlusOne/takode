import { useState } from "react";
import { NotifyMeControlView, NotifyMeIcon } from "../NotifyMe.js";
import { Card } from "./shared.js";

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
