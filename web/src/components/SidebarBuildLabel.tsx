interface SidebarBuildLabelProps {
  buildTime: string;
  onOpenChangelog?: () => void;
}

export function SidebarBuildLabel({ buildTime, onOpenChangelog }: SidebarBuildLabelProps) {
  const label = formatSidebarBuildLabel(buildTime);

  return (
    <button
      type="button"
      title={`Open changelog (${buildTime})`}
      aria-label={`${label}. Open changelog`}
      onClick={() => {
        window.location.hash = "#/changelog";
        onOpenChangelog?.();
      }}
      className="mx-auto block max-w-full rounded-md px-2 py-1 text-center text-[10px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus:outline-none focus:ring-2 focus:ring-cc-primary/40"
    >
      {label}
    </button>
  );
}

function formatSidebarBuildLabel(buildTime: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  }).formatToParts(new Date(buildTime));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";

  return `Built ${part("month")} ${part("day")}, ${part("hour")}:${part("minute")} ${part("dayPeriod")} PT`;
}
