/**
 * The machine a quest note or debrief was written on. Paths and commands in
 * it refer to that machine, which matters once sessions run on several.
 */
export function QuestMachineStamp({
  machine,
  className = "text-[10px] text-cc-muted",
}: {
  machine?: string;
  className?: string;
}) {
  if (!machine) return null;
  return (
    <span
      className={className}
      title={`Written on ${machine}: paths and commands in it refer to that machine`}
      data-testid="quest-machine-stamp"
    >
      on {machine}
    </span>
  );
}
