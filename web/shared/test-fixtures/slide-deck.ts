import type { MarkdownReportMessage } from "../markdown-report.js";

/** A synthetic slide deck report written script first: few words and a visual or code per slide, speaker notes under each. */
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

Notes:

This is a short walkthrough of the build cache: what it stores, when a build can reuse it, and what changed last week.

---

## Only compile what changed

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

Notes:

Every build asks the cache first. Each target's inputs are hashed into a key, and when that key is already stored, the build reuses the output instead of compiling it again. Only targets whose key is new get compiled.

---

## The key

\`\`\`ts
const key = hash([
  target.sources,        // file contents, not timestamps
  target.dependencies,   // the keys of what it imports
  toolchain.version,
  build.flags,
]);
\`\`\`

Notes:

The key covers everything that can change a target's output: its source files, the keys of what it imports, the toolchain version and the build flags. Timestamps are deliberately left out, so a fresh checkout still hits the cache. And because a dependency's key is part of the key, a change ripples up to everything that imports it.

---

## Hits since Thursday

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

Notes:

Early in the week about two builds in three hit the cache. On Thursday we took timestamps out of the key, and the hit rate jumped to the mid-eighties and stayed there.

---

## Next

- Share across CI
- Keep 14 days
- Report hit rate

Notes:

Three things next. Share the cache between CI machines, so one machine's work helps the others. Keep outputs for fourteen days instead of seven. And report the hit rate on every build, so a drop shows up right away.
`;
