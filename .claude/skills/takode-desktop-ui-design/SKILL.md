---
name: takode-desktop-ui-design
description: "Use before designing, building or reviewing Takode UI for wide screens: side-by-side split views, list-and-detail panes, side panels, sidebars and resizable dividers (every split view gets a draggable divider)."
---

# Takode Desktop UI Design

The user's preferences for Takode on wide screens, with the reasons behind them. Apply them when designing or reviewing any surface that shows two or more panes side by side. For phones, read the `takode-mobile-ui-design` skill.

## Every split view has a draggable divider

Wherever Takode shows panes side by side (a list beside its detail, a side panel beside the conversation, a file list beside an editor), the divider between them can be dragged to resize them.

**Why:** a fixed divider forces one layout on every screen and every task. The user found the Library's fixed list-and-detail split annoying: a long topic page wanted more room, a list of long titles wanted more, and nothing could be adjusted. The user asked for this as a general rule in October 2026.

**How:**
- Use `useSplitWidth` and `SplitHandle` from `web/src/components/SplitHandle.tsx`; do not hand-roll another divider. Give each split its own ID, a default width, and a minimum and maximum that keep both panes usable.
- The pane takes its width from the `--split-w` variable the hook sets (`style={split.style}` plus a class such as `md:w-[var(--split-w)]`). Place `SplitHandle` between the panes in a flex row, or with `gapCenter` over the gap of a grid of cards.
- Show the handle only at the widths where the panes are side by side (its `className`, such as `hidden lg:block`). Phones show one pane at a time and need no divider.
- The handle drags with a mouse or finger, resets on double-click, and moves with the arrow keys when focused. Widths are remembered per split in the browser, as a local preference.
- A pane beside or over the conversation (the topic panel, Side Chat, the secondary view) passes `share: true`: once the user drags it, its width is kept as a share of the window and recomputed when the window changes size, within its minimum and maximum, instead of a fixed pixel width. Panes whose content has a natural width (the sessions list, a file list) keep pixels.
- Before adding a two-pane layout, ask whether it should be a split at all. The Library's artifacts became a full-width gallery whose items open large, instead of a list beside a detail pane; topics moved to a panel beside the conversation.

**Splits that follow the rule (October 2026):** the sessions panel and the session panel beside the conversation, Side Chat, the topic panel beside a leader's conversation, the Codex subagent list, the Memory page's side panel, the Logs page's filters, and the CLAUDE.md editor's file list. The secondary view (Settings, Questmaster, Artifacts, Memory and the viewers opened from the conversation, on wide screens) floats over the app instead of splitting it, but its left edge is a divider too (since October 30, 2026, at the user's request: a side panel's width should be the user's, not Takode's). Its width is kept per kind of content (pages, reading, wide, media, full) as a share of the window.
