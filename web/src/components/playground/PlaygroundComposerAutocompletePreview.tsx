import { Card } from "./shared.js";

function ReferenceIcon({ kind }: { kind: "quest" | "session" }) {
  if (kind === "quest") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
        <path d="M5 3.5h6" strokeLinecap="round" />
        <path d="M5 8h6" strokeLinecap="round" />
        <path d="M5 12.5h4" strokeLinecap="round" />
        <rect x="2.5" y="1.75" width="11" height="12.5" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReferenceSuggestionRow({
  rawRef,
  kind,
  preview,
  selected = false,
}: {
  rawRef: string;
  kind: "quest" | "session";
  preview: string;
  selected?: boolean;
}) {
  return (
    <div className={`flex w-full items-center gap-2.5 px-3 py-2 ${selected ? "bg-cc-hover" : ""}`}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cc-hover text-cc-muted">
        <ReferenceIcon kind={kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-cc-fg">{rawRef}</span>
          <span className="shrink-0 text-[11px] text-cc-muted">{kind}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-cc-muted">{preview}</div>
      </div>
    </div>
  );
}

function ComposerFooterMock() {
  return (
    <div className="flex items-center justify-between px-2.5 pb-2.5">
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-cc-muted">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path
            d="M2.5 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M8.5 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span>agent</span>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cc-primary text-white">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
          <path d="M2 2.5L14 8 2 13.5 2 9.5 9 8 2 6.5Z" />
        </svg>
      </div>
    </div>
  );
}

export function PlaygroundQuestSessionAutocompletePreview() {
  return (
    <Card label="Quest/session ref autocomplete">
      <div className="border-t border-cc-border bg-cc-card px-4 py-3">
        <div className="relative rounded-[14px] border border-cc-border bg-cc-input-bg">
          <div className="absolute left-2 right-2 bottom-full mb-1 rounded-[10px] border border-cc-border bg-cc-card py-1 shadow-lg">
            <ReferenceSuggestionRow
              rawRef="q-477"
              kind="quest"
              preview="Autocomplete quest and session refs"
              selected
            />
            <ReferenceSuggestionRow rawRef="#687" kind="session" preview="Autocomplete quest and session refs" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
            {["q-477", "#687"].map((ref) => (
              <span
                key={ref}
                className="inline-flex max-w-[160px] items-center rounded-md border border-cc-border/70 bg-cc-hover/45 px-1.5 py-0.5 font-mono-code text-[11px] leading-4 text-cc-primary"
              >
                {ref}
              </span>
            ))}
          </div>
          <textarea
            readOnly
            value="Follow up on q-477 and sync with #687"
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 font-sans-ui text-sm text-cc-fg"
            style={{ minHeight: "36px" }}
          />
          <ComposerFooterMock />
        </div>
        <div className="relative mt-16 rounded-[14px] border border-cc-border bg-cc-input-bg">
          <div className="absolute left-2 right-2 bottom-full mb-1 rounded-[10px] border border-cc-border bg-cc-card py-1 shadow-lg">
            <div className="px-3 py-2.5 text-[12px] text-cc-muted">Loading quests...</div>
          </div>
          <textarea
            readOnly
            value="Follow up on q-15"
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 font-sans-ui text-sm text-cc-fg"
            style={{ minHeight: "36px" }}
          />
          <div className="px-4 pb-2 text-[11px] text-cc-muted">
            Quest autocomplete keeps the false empty state hidden while the all-known quest list loads.
          </div>
        </div>
      </div>
    </Card>
  );
}
