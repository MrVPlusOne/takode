---
name: visual-blocks
description: Use when an answer, report or guided review would explain better with a picture than with prose or a table: a pipeline or flow, who sends what to whom, a timeline or branch history, before/after, nested counts, numbers across runs or steps. Also use when asked for slides, a presentation or a deck. Explains the ```visual block, Takode's visual kit (pipelines, flows, sequences, timelines, comparisons, stat cards, rows, nested sets, bars, notes), the Mermaid and chart helpers, the required preview with `takode visual preview` before publishing, and slide decks (`slides: true` reports shown one slide at a time).
---

# Visual blocks

A ```visual fence in any Markdown you write (chat answers, `takode report` files, guided-review overviews and stop notes) shows a visual drawn from HTML, CSS and SVG, in Takode's own look, in both themes, at phone and desktop width. Takode runs it in a sandboxed frame, so a mistake can't break the app, but a mistake still makes your answer worse. Preview every visual before you publish it.

## When a visual helps

Draw when the reader needs to see **order** (three or more steps, a pipeline, a branch history), **who talks to whom** (agents, hosts, ports, services), **containment** (1,600 tasks, 220 of them with a sidecar, 10 that matter), or **numbers across two dimensions** (runs by benchmarks, gains with noise ranges). Don't draw an argument, a tradeoff or a single fact: write a sentence.

- Lead with the one-sentence answer in prose, then the visual, then only what the picture can't say.
- One visual per point. Keep it small: about 12 boxes, a dozen rows.
- Never pick colours. Use tones: `data-tone="decide|look|checked|good|bad|warn|muted|primary"`.

## Format

````
```visual
title: Short title shown above the visual
alt: Plain-text version of everything the visual says. Read aloud, Copy for Slack and search use it, so make it complete.
---
<div class="tk-flow tk-numbered">...</div>
```
````

`alt:` is required. The HTML is the body of a page; Takode adds its kit stylesheet and theme. Inline `<style>` and `<script>` work but are rarely needed: prefer the kit.

## The kit

| Shape | Markup |
|---|---|
| Stat cards | `<div class="tk-stats"><div class="tk-stat" data-tone="decide"><b>5</b><span>decisions</span></div>…</div>` |
| Flow or pipeline (arrows between boxes; stacks top-down on phones) | `<div class="tk-flow">` with `.tk-box`, `.tk-card` or `.tk-stage` children. Add `tk-numbered` to number stages, `tk-down` to always stack. Label the arrow into a box with `<span class="tk-in">case index</span>` as its first child. |
| Stage contents | `<h3>`, `<div class="tk-sub">`, `<div class="tk-steps"><div class="tk-step">Step<small>detail</small></div>…</div>`, `<div class="tk-out"><span>output</span></div>`, `<div class="tk-aside">` for a dashed side note |
| Sequence (who sends what) | `<div class="tk-seq"><div class="tk-msg"><span class="tk-actor" data-tone="look">Worker</span><span class="tk-to"></span><span class="tk-actor">Server</span><span>message</span></div>…</div>`; add `tk-back` to a reply |
| Timeline | `<div class="tk-timeline"><div class="tk-event" data-tone="look"><time>when or lane</time>What happened</div>…</div>` |
| Before / after, side by side | `<div class="tk-compare"><div class="tk-side" data-tone="bad"><h4>Before</h4><ul><li>…</li></ul></div>…</div>` |
| Findings with chips | `<div class="tk-rows"><div class="tk-head">Header</div><div class="tk-row" data-tone="decide"><div>What<small>why</small></div><div class="tk-chips"><span class="tk-chip">area</span></div></div>…</div>` |
| Nested counts | `<div class="tk-nest"><div class="tk-set"><b>1,600</b><span>tasks</span><div class="tk-set" data-tone="look">…</div></div></div>` |
| Bars | `<div class="tk-bars"><div class="tk-bar" data-tone="look"><span>Label</span><i style="--v:.62"></i><b>62%</b></div>…</div>` (`--v` from 0 to 1) |
| Callout | `<div class="tk-note" data-tone="warn"><b>Note:</b> …</div>` |
| Small labels | `.tk-section` (uppercase heading), `.tk-lead`, `.tk-caption`, `.tk-legend > span[data-tone]`, `.tk-badge[data-tone]`, `code` |
| Cards grid | `<div class="tk-grid"><div class="tk-card">…</div></div>` |

## Helpers

- **Diagrams:** `<pre class="tk-mermaid">flowchart TB …</pre>` renders Mermaid in Takode's theme. Prefer `TB` layouts and short labels; `class nodeId decide` (any tone) colours a node. Wide diagrams (sequence diagrams with many participants, gitGraph) scroll sideways on phones: use the kit's `tk-seq` or `tk-timeline` instead.
- **Charts:** `<script type="application/json" class="tk-chart">{Vega-Lite spec}</script>`. Data inline, units on axes, uncertainty as a labelled range; the width fills the column. Don't set colours.

## Always preview

```bash
takode visual preview visual.txt      # the fence body, or a file with the whole fence
```

It renders the visual on the Takode server at a phone's and a desktop's message width, dark and light, writes four PNGs and prints checks: missing alt text, script errors, sideways scrolling on phones, text under 11 px, too many elements, too tall, slow. **Look at all four images**, fix what's wrong and preview again before you publish. Then paste the same text into the ```visual fence. The preview is for you: don't mention it in the answer.

## Slides

When asked for slides, a presentation or a deck, publish a `takode report` file written as a deck. Takode shows it one slide at a time with previous/next and Present (full screen), and exports it as a PDF with one slide per page.

````markdown
---
slides: true
---

# The deck's title

*One line on what it covers.*

---

## One point per slide

A lead sentence, then one visual, a short code block or a few bullets.
````

- `slides: true` front matter opens the file. A `---` line with a blank line before it starts the next slide (`---` inside a fence, like a visual's header, doesn't).
- A slide that starts with a `#` heading is a title slide and sits in the middle. Give every other slide a `##` heading: it names the slide in the slide list.
- **A slide is one screen.** On wide screens it is a 16:9 slide laid out at 1280x720 with large text; visuals draw half again as large. Aim for a heading, at most about four lines of prose or five bullets, and one visual or a code block of up to about 12 lines. A longer slide shrinks, down to half size, and then scrolls, which reads badly when presenting: split it into two slides instead, and put detail that fits no slide in a separate report the deck links to.
- On a phone held upright each slide shows as a page at reading size that scrolls, so the same file works there.

## Limits

Up to 256 KB of source and 6,000 elements. Every visual runs in a sandboxed frame with no access to Takode. Takode stops a visual that hangs, crashes, keeps the processor busy or slows the app, and from then on that device shows it as a still picture (drawn on the server) with a Run button. On iPhones, a visual with scripts runs only after the server drew it cleanly, so one that loops or is far too big shows its alt text instead. Keep scripts for what needs them (charts, toggles); kit shapes need none.
