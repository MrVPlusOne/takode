import { shortenHome } from "../utils/path-display.js";

interface SessionPathSummaryProps {
  cwd?: string | null;
  repoRoot?: string | null;
  isWorktree?: boolean;
  testIdPrefix?: string;
}

interface PathRow {
  key: string;
  label: string | null;
  path: string;
}

function splitDisplayPath(path: string): { full: string; prefix: string; tail: string } {
  const full = shortenHome(path);
  const normalized = full.length > 1 ? full.replace(/\/+$/, "") : full;
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return { full, prefix: "", tail: normalized };
  return {
    full,
    prefix: normalized.slice(0, slashIndex + 1),
    tail: normalized.slice(slashIndex + 1),
  };
}

export function SessionPathSummary({ cwd, repoRoot, isWorktree, testIdPrefix }: SessionPathSummaryProps) {
  const rows: PathRow[] = [];
  if (!cwd) return null;

  const showBaseRepo = isWorktree === true && !!repoRoot && repoRoot !== cwd;
  if (showBaseRepo) {
    rows.push({ key: "worktree", label: "Worktree", path: cwd });
    rows.push({ key: "repo", label: "Base repo", path: repoRoot! });
  } else {
    rows.push({ key: "path", label: null, path: cwd });
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const { full, prefix, tail } = splitDisplayPath(row.path);
        return (
          <div
            key={row.key}
            data-testid={testIdPrefix ? `${testIdPrefix}-${row.key}` : undefined}
            className="min-w-0"
            title={row.path}
          >
            {row.label && (
              <div className="mb-0.5 text-[9px] uppercase tracking-[0.16em] text-cc-muted/55">{row.label}</div>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 text-cc-muted/45">
                <path d="M1 3.5A1.5 1.5 0 012.5 2h3.379a1.5 1.5 0 011.06.44l.622.621a.5.5 0 00.353.146H13.5A1.5 1.5 0 0115 4.707V12.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
              </svg>
              <div className="flex min-w-0 items-baseline overflow-hidden whitespace-nowrap font-mono-code text-[11px]">
                {prefix && <span className="min-w-0 truncate text-cc-muted/55">{prefix}</span>}
                <span
                  data-testid={testIdPrefix ? `${testIdPrefix}-${row.key}-tail` : undefined}
                  className="max-w-[75%] shrink-0 truncate font-semibold text-cc-fg/95"
                >
                  {tail || full}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
