/**
 * The glossary as a page of its own (`#/glossary`), for people new to Takode: how the main pieces
 * fit together, then every term from `glossary.md`, in two columns on wide screens.
 */
import { useEffect, type ReactNode } from "react";
import { GLOSSARY, type GlossarySection } from "./glossary.js";
import { recordGlossaryOpened } from "./glossary-opened.js";

export function GlossaryPage() {
  useEffect(() => recordGlossaryOpened(), []);
  const workflows = GLOSSARY.sections.filter((section) => section.title === "Common workflows");
  const terms = GLOSSARY.sections.filter((section) => section.title !== "Common workflows");
  return (
    <div className="h-full overflow-y-auto bg-cc-bg font-sans-ui text-cc-fg antialiased" data-testid="glossary-page">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <header className="mb-5">
          <h1 className="text-xl font-semibold">Takode at a glance</h1>
          {GLOSSARY.intro.map((paragraph) => (
            <p key={paragraph} className="mt-2 max-w-3xl text-[14px] leading-relaxed text-cc-muted">
              <GlossaryText text={paragraph} />
            </p>
          ))}
        </header>
        <HowItFits />
        <div className="mt-6 grid gap-x-10 md:grid-cols-2">
          <div>
            <GlossarySections sections={terms.slice(0, 3)} />
          </div>
          <div>
            <GlossarySections sections={terms.slice(3)} />
            <GlossarySections sections={workflows} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** You talk to a leader; it files quests and hands them to workers; its Scribe keeps things tidy. */
function HowItFits() {
  return (
    <div
      className="grid gap-2 rounded-xl border border-cc-border bg-cc-card p-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-stretch"
      aria-label="How the pieces fit"
    >
      <Box title="You" text="Ask on a leader's Home, answer its questions, read its results." />
      <Arrow />
      <Box
        title="Leader"
        text="Keeps one thread per subject, files quests, briefs and checks workers."
        tone="primary"
      />
      <Arrow />
      <Box title="Quests" text="Durable tasks on the Work Board, each going Work → Memory." />
      <Arrow />
      <Box title="Workers" text="Ordinary sessions doing one quest each, in their own worktree." />
      <div className="sm:col-span-7">
        <Box
          title="Scribe"
          text="Beside each leader: names threads, files them under topics, writes Home's news lines."
          tone="muted"
        />
      </div>
    </div>
  );
}

function Box({ title, text, tone }: { title: string; text: ReactNode; tone?: "primary" | "muted" }) {
  const border = tone === "primary" ? "border-cc-primary/50" : tone === "muted" ? "border-dashed" : "";
  return (
    <div className={`h-full rounded-lg border border-cc-border bg-cc-bg px-3 py-2 ${border}`}>
      <div className="text-[13px] font-medium">{title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-cc-muted">{text}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-cc-muted" aria-hidden="true">
      <span className="sm:hidden">↓</span>
      <span className="hidden sm:inline">→</span>
    </div>
  );
}

/** The glossary's sections as headed lists of terms. */
function GlossarySections({ sections }: { sections: GlossarySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="mt-4 first:mt-1" aria-label={section.title}>
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-cc-muted">{section.title}</h3>
          <dl>
            {section.entries.map((entry) => (
              <div
                key={entry.id}
                data-glossary-id={entry.id}
                className="scroll-mt-2 border-b border-cc-border/60 py-2 last:border-b-0 sm:grid sm:grid-cols-[9.5rem_1fr] sm:gap-x-4"
              >
                <dt className="text-[14px] font-medium text-cc-fg">{entry.term}</dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed text-cc-fg/80 sm:mt-0">
                  <GlossaryText text={sentence(entry.text)} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}

/** Entries read as sentences of their own once their term is set apart. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Glossary text with its inline `**bold**` and `code` kept; nothing else is Markdown here. */
function GlossaryText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      match[1] !== undefined ? (
        <strong key={index} className="font-medium text-cc-fg">
          {match[1]}
        </strong>
      ) : (
        <code key={index} className="rounded bg-cc-hover px-1 font-mono text-[12px]">
          {match[2]}
        </code>
      ),
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
