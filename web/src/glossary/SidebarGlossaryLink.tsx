import { openGlossary } from "./open-glossary.js";
import { useGlossaryOpened } from "./glossary-opened.js";

/**
 * "Glossary" beside the build label at the foot of the sessions panel. Until the user first opens
 * the glossary (on this server, from any device) it is drawn in the accent colour with a dot, so
 * people new to Takode, or new to this build, notice it; afterwards it is as quiet as the label.
 */
export function SidebarGlossaryLink({ closePanel }: { closePanel: boolean }) {
  const highlighted = useGlossaryOpened() === false;
  return (
    <button
      type="button"
      onClick={() => openGlossary({ closePanel })}
      title={highlighted ? "New: what Takode's terms mean" : "Glossary: Takode at a glance"}
      data-testid="sidebar-glossary-link"
      data-highlighted={highlighted ? "true" : "false"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors hover:bg-cc-hover focus:outline-none focus:ring-2 focus:ring-cc-primary/40 ${
        highlighted ? "text-cc-primary" : "text-cc-muted hover:text-cc-fg"
      }`}
    >
      {highlighted && <span className="h-1.5 w-1.5 rounded-full bg-cc-primary" aria-hidden="true" />}
      Glossary
    </button>
  );
}
