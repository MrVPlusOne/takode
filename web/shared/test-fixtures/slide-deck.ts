import type { MarkdownReportMessage } from "../markdown-report.js";

/** A synthetic slide deck report: a title slide, a visual, code, a list and a chart-like visual. */
export function makeSlideDeckReportFixture(): MarkdownReportMessage {
  return {
    type: "markdown_report",
    id: "slide-deck-fixture",
    timestamp: 1791000000000,
    threadKey: "q-42",
    questId: "q-42",
    source: {
      sessionId: "report-host",
      reportId: "slide-deck-fixture",
      sourcePath: "/project/reports/cache-walkthrough.md",
      sha256: "b".repeat(64),
    },
    content: SLIDE_DECK_MARKDOWN,
  };
}

const SLIDE_DECK_MARKDOWN = `---
slides: true
---

# How the build cache works

*A walkthrough of what is cached, when it is reused and what we measured last week.*

---

## The whole pipeline on one page

Every build asks the cache first and **only compiles what changed**.

\`\`\`visual
title: From a commit to a finished build
alt: Four stages. Commit: the changed files. Hash: each target's inputs are hashed. Cache: a hit reuses the stored output, a miss compiles. Result: the build with its timing.
---
<div class="tk-flow tk-numbered">
  <div class="tk-stage"><h3>Commit</h3><div class="tk-sub">changed files</div></div>
  <div class="tk-stage" data-tone="look"><h3>Hash</h3><div class="tk-sub">inputs of each target</div><div class="tk-out"><span>cache key</span></div></div>
  <div class="tk-stage" data-tone="checked"><h3>Cache</h3><div class="tk-sub">hit: reuse · miss: compile</div></div>
  <div class="tk-stage" data-tone="good"><h3>Result</h3><div class="tk-sub">build and timing</div></div>
</div>
\`\`\`

---

## What goes into a cache key

A target's key is a hash of everything that can change its output:

\`\`\`ts
const key = hash([
  target.sources,        // file contents, not timestamps
  target.dependencies,   // the keys of what it imports
  toolchain.version,
  build.flags,
]);
\`\`\`

- Timestamps are left out, so a fresh checkout still hits.
- A dependency's key is part of the key, so a change ripples up.

---

## Last week's builds

\`\`\`visual
title: Cache hits per day
alt: Hit rate per day last week. Monday 62 percent, Tuesday 71, Wednesday 68, Thursday 83, Friday 88.
---
<div class="tk-bars">
  <div class="tk-bar"><span>Mon</span><i style="--v:.62"></i><b>62%</b></div>
  <div class="tk-bar"><span>Tue</span><i style="--v:.71"></i><b>71%</b></div>
  <div class="tk-bar"><span>Wed</span><i style="--v:.68"></i><b>68%</b></div>
  <div class="tk-bar" data-tone="good"><span>Thu</span><i style="--v:.83"></i><b>83%</b></div>
  <div class="tk-bar" data-tone="good"><span>Fri</span><i style="--v:.88"></i><b>88%</b></div>
</div>
\`\`\`

Hits rose after Thursday's change took timestamps out of the key.

---

## Next steps

1. Share the cache between CI machines.
2. Keep outputs for 14 days instead of 7.
3. Report the hit rate on every build.
`;
