---
name: takode-desktop-ui-design
description: "Use before designing, building or reviewing Takode UI for wide screens: side-by-side split views, list-and-detail panes, side panels, sidebars, several groups stacked in one panel, collapsible sections and groups (every fold is remembered), resizable dividers (every split view and stack of groups gets a draggable divider), and button tooltips (every button explains itself on hover)."
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

## Groups stacked in one panel work like VS Code's side bar

When one panel shows two or more groups one above the other (the sessions panel's Topics, Leaders and Other sessions), each group folds from its header, each scrolls on its own, and the line between two open groups can be dragged to set how much height each gets. No group gets a "Show N more" button: its own scrolling already shows the rest.

**Why:** the user stated this as a general principle in October 2026, choosing the Topics mode for the sessions panel: a group the user doesn't need right now should fold away, and the proportion between groups is the user's to set, not Takode's. Before, a fixed "Show 18 more" cut the list and pushed the next group off screen.

**How:**
- Use `StackedPanes` from `web/src/components/StackedPanes.tsx`; do not hand-roll another stack. Give each stack its own ID and each group an ID, a title and a `defaultWeight` for its share of the height before the user drags.
- Folded groups are remembered folds (see below) and sizes are remembered per stack in the browser (`cc-stacked-panes`), both as local preferences. A divider drags with a mouse or finger, moves with the arrow keys when focused, and resets all sizes on double-click. A divider shows only between two open groups.
- The panel holding the stack must not scroll itself (give it `min-h-0` and `overflow-hidden`), or the groups can't take their share of its height.

**Never nest a scrolling panel inside another scrolling panel.** When a panel scrolls as a whole and something inside it (a chat, a page) scrolls too, a partly scrolled panel hides the inner part's top, a wheel moves only the inner part, and nothing shows which of the two is scrolled. The leader's side column did this from October 31 until the user replaced it on November 14, 2026, after first trying a strip that scrolled the column. Instead, give the panel fixed parts that each scroll on their own: `StackedPanes` for a fixed set of groups sharing the panel, or tabs that each fill it. The side column (`SideColumn.tsx`) uses tabs, the user's choice over a fitted stack and a one-section-at-a-time column: Chats, Quests and Pages while they hold something, each with its count, then Topic. In each tab one item is open at a time and fills what the tab's rows leave. While another tab is on screen, the Chats tab shows what waits in the chats (the question bell and "N new", else a green dot while a leader writes).

## Every fold stays as the user left it

A section or group that folds (sidebar groups and the archive, Overview and topic-page sections, Session Info sections, Memory folders, to-do categories, workers under a leader card) keeps the user's open or closed choice across reloads, view and session switches and reconnects, on phones and desktops alike.

**Why:** the user found themselves folding the same groups again and again (October 31, 2026). Each fold had its own storage, some didn't remember at all, and while the browser's storage was full nothing could be saved.

**How:**
- Use `useRememberedFold(id, foldedByDefault)` (or `useRememberedFolds()` when the IDs come from a list) from `web/src/utils/remembered-folds.ts`; do not keep a fold in component state or its own storage key. Name the ID by surface, such as `sidebar:archived` or `topic:<topicId>:<section>`.
- Folds are per browser, not synced through the server: phones and desktops lay sections out differently. They follow changes made in other tabs.
- The one exception: the leader portrait picker's pool groups are a server setting (`leaderProfileCollapsedPools`), because the user wanted them to match on every device. Leave them on the server.
- Disclosures that belong to one item and reset on purpose (a message's details, a quest's Journey section, a list of pending changes to act on) are not sections and stay in component state.

## Every button explains itself on hover

Resting the mouse on any button shows what it does: its tooltip text, and the keyboard shortcut when it has one.

**Why:** the user asked for it across the UI (November 2, 2026): icon buttons, such as the side column's header buttons, gave no hint of what they do. Browsers show a `title` late and unevenly, and never show an `aria-label`.

**How:**
- Takode draws the tooltip itself (`AppTooltips` in `web/src/components/AppTooltips.tsx`), from the element's `title`, or, for a button with no text of its own (an icon), its `aria-label`. Name buttons the usual way; don't build another tooltip.
- Give every icon-only button a `title` (or an `aria-label`). Put a shortcut in it with `getShortcutTitle` from `web/src/shortcuts.ts`. A button whose own words say what it does needs nothing more.
- Something that opens a hover card or preview of its own (session, quest and notification links) sets `data-tooltip="off"`, so the tooltip doesn't land beside its card.
- A tooltip is only a short label for a control. A row, chip or card that stands for something (a session, quest or thread) previews it on hover with a hover card styled like the session and quest cards (`SessionHoverCard`, `QuestHoverCard`, the Threads view's `ThreadHoverCard`), never with a multi-line `title`. **Why:** the user found the Threads view's plain-text tooltip of title over update ugly (November 3, 2026) and wants plain tooltips kept for button labels.
- `web/src/icon-button-names.test.ts` fails on an icon-only button with no `title` or `aria-label`; it can't judge one whose icon is computed in code. Details and history: the memory note `session-ui/button-tooltips.md`.
