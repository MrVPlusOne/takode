/**
 * Shown under a worker message that ended with a `{[(Quiet: ...)]}` marker, in place
 * of the raw marker line: the worker told Takode its leader need not be woken.
 */
export function QuietTurnNote({ summary }: { summary: string }) {
  return (
    <div
      className="!mt-1 flex min-w-0 items-baseline gap-1.5 font-sans-ui text-[11px] leading-4 text-cc-muted"
      title="Marked quiet: this turn does not wake the leader"
      data-testid="quiet-turn-note"
    >
      <span className="shrink-0 rounded-full border border-cc-border px-1.5 text-[10px]">quiet</span>
      <span className="min-w-0 truncate">{summary}</span>
    </div>
  );
}
