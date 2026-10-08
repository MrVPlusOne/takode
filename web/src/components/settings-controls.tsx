import { useId, useState, type FormEvent, type ReactNode } from "react";

/**
 * A titled block inside a Settings group. Groups are the navigable top-level
 * cards; subsections keep related controls together inside them.
 */
export function SettingsSubsection({
  title,
  description,
  hidden = false,
  as: Tag = "section",
  onSubmit,
  children,
}: {
  title: string;
  description?: ReactNode;
  hidden?: boolean;
  as?: "section" | "form";
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <Tag
      {...(Tag === "form" ? { onSubmit } : {})}
      hidden={hidden}
      className="space-y-3 border-t border-cc-border/70 pt-4 first:border-t-0 first:pt-0"
    >
      <div>
        <h3 className="text-sm font-semibold text-cc-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-cc-muted">{description}</p>}
      </div>
      {children}
    </Tag>
  );
}

/** The visual on/off track. Purely presentational; the caller owns the switch semantics. */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-cc-primary" : "bg-cc-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

/**
 * A full-width row for one boolean setting. The whole row is the switch so it
 * is an easy tap target on phones, and the track shows state at a glance.
 */
export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  hidden = false,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hidden?: boolean;
}) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      hidden={hidden}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
    >
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-xs text-cc-muted">
            {description}
          </span>
        )}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

/** Pick exactly one of a few named options, with every option visible. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded-lg bg-cc-bg p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer select-none ${
              selected ? "bg-cc-primary/15 text-cc-primary" : "text-cc-muted hover:text-cc-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A row with a label on the left and its control on the right, matching the
 * toggle rows so mixed control types line up.
 */
export function SettingsRow({
  label,
  htmlFor,
  description,
  hidden = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={hidden} className="px-3 py-2.5 rounded-lg bg-cc-hover text-cc-fg">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-sm" htmlFor={htmlFor}>
            {label}
          </label>
          {description && <p className="mt-0.5 text-xs text-cc-muted">{description}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * Minus / value / plus control for a bounded number. The value can also be
 * typed; typed input is applied on blur or Enter so partial text is not saved.
 */
export function NumberStepper({
  id,
  label,
  value,
  step,
  min,
  max,
  decimals = 0,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  decimals?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  // Text being typed; null when not editing, so the field always shows the current value otherwise.
  const [draft, setDraft] = useState<string | null>(null);

  const apply = (next: number) => {
    const clamped = Math.min(max, Math.max(min, Number(next.toFixed(decimals))));
    if (clamped !== value) onChange(clamped);
  };
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(/[^0-9.]/g, ""));
    setDraft(null);
    if (Number.isFinite(parsed)) apply(parsed);
  };
  const buttonClass =
    "w-7 h-7 flex items-center justify-center rounded-md text-sm font-medium text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => apply(value - step)}
        disabled={value <= min}
        className={buttonClass}
      >
        −
      </button>
      <div className="flex items-center rounded-md border border-cc-border bg-cc-input-bg pr-2 focus-within:border-cc-primary/60">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft ?? value.toFixed(decimals)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
          }}
          className="w-12 bg-transparent py-1 text-right text-xs text-cc-fg focus:outline-none"
        />
        <span className="pl-0.5 text-xs text-cc-muted">{suffix}</span>
      </div>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => apply(value + step)}
        disabled={value >= max}
        className={buttonClass}
      >
        +
      </button>
    </div>
  );
}
