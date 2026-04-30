# Port -- Assignee Brief

You are syncing accepted git-tracked work back to the main repo.

Boundary:
- Port the accepted tracked changes and report ordered synced SHAs from the main repo.
- Run the required post-port verification after sync.
- Do not invent port commentary for zero-tracked-change quests whose Journey omitted `port`.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase port`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write full agent-oriented detail first, then add TLDR metadata that preserves the major points.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document ordered synced SHAs, post-port verification, port anomalies, and remaining sync risks. Keep the dedicated `Synced SHAs: sha1,sha2` report line separate for leader bookkeeping.

Deliverable:
- Return synced SHAs plus post-port verification results, then stop.
