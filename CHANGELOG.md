# Takode Changelog

## 2026-05-28

### Changed

- **Codex leader recycling** -- Codex leader recycle thresholds now derive from source effective context with fixed headroom, and normal leader budget and per-model override controls are hidden
- **Codex non-leader compaction** -- Non-leader Codex sessions now rely on Codex default auto-compaction while preserving legacy settings/API compatibility and user-owned Codex config

### Fixed

- **Quest worker context** -- Board/Journey-assigned workers and reviewers now show quest banner context even when Questmaster ownership remains with another session, with stale task-history chips hidden where the banner is authoritative
- **Worker replacement display** -- Quest headers and worker chips follow the current Work Board/Journey worker after replacement, and replacement spawn updates matching active board rows or prints compact board-update guidance
- **Leader hover active quests** -- Leader hover cards hydrate exact active board rows from server snapshots and live updates, restoring active quest lists consistently across leader sessions

## 2026-05-27

### Fixed

- **Codex session catalogs** -- Session-local Codex model catalogs can synthesize or repair parser-safe selected model entries when cache data is missing or minimal
- **Session location after restart** -- Restored sessions preserve Session Space, memory-space, and leader open-tab metadata more reliably, with stale default Session Space state reconciled during list hydration
- **Quest commit diff modal** -- Quest commit diff modals keep a stable full-available footprint while switching commits, including loading, error, and unavailable states
- **Work Board tab hover** -- Work Board tab close-hover states avoid width drift

## 2026-05-26

### Added

- **Quest feedback controls** -- Quest Detail can delete user feedback, labels user-authored feedback as `user`, and shows session-submitted feedback as `on behalf of user`
- **Composer shortcut tooltip** -- The send button tooltip now shows both send and newline shortcuts while preserving the accessible `Send message` action name

### Fixed

- **Delayed Pushover cancellation** -- Resolved needs-input prompts now cancel only their own scheduled delayed Pushover push while other unresolved prompts remain scheduled
- **Needs-input resolution chips** -- Needs-input resolution notices render as collapsed special-message chips with concise expanded context and the duplicate-resolution warning preserved
- **Codex instruction isolation** -- Takode session developer instructions stay in per-session Codex homes instead of leaking into host/global Codex config
- **Codex spawn prep stalls** -- Repeated Codex worker spawn/replacement prep avoids unnecessary DotSlash scans and unchanged legacy skill migration work
- **Relaunch stale PID handling** -- Relaunch treats untracked persisted PIDs as best-effort cleanup only, preserving graceful escalation for tracked live subprocesses

### Changed

- **Takode CI policy** -- GitHub Actions now follows the repository's pinned Bun, frozen install, and no-install script execution policy

## 2026-05-25

### Added

- **Transcription debug recordings** -- Transcription debug mode can persist per-request recording folders with audio, prompts, results, timing, failure artifacts, and copy/open/delete controls

### Changed

- **Work Board tool-call chips** -- Collapsed Work Board tool calls now look like terminal command chips, show the raw `takode board ...` command, and keep raw/graphical toggles inside expanded content
- **Memory entry defaults** -- Opening Memory now defaults to the last viewed session's available session-space root while preserving manual cross-space selection inside Memory
- **Quest commit display** -- Quest Detail uses a collapsed-by-default `Commits` section that shows only the commit count until expanded

### Fixed

- **Completed quest board cleanup** -- Done quests, including rows stuck at Memory, leave active Work Board state while unfinished Memory rows remain active
- **Repeated error cards** -- Visually consecutive identical chat error cards group together even across hidden feed markers while visible separators still split groups
- **Quote selection cleanup** -- Quoted chat selections trim leading and trailing blank-line edges while preserving internal blank lines
- **Quest commit modal spacing** -- Quest commit diff modal headers and content spacing are tighter and more stable

## 2026-05-23

### Added

- **Sidebar changelog entry point** -- The sidebar build label now opens the in-app changelog viewer alongside the Settings entry point

### Fixed

- **Codex backend error auto-pause** -- Repeated classified Codex backend result errors now pause and coalesce automatic inputs while keeping manual recovery paths available
- **Codex auto-pause recovery** -- Queued Codex backlog and browser-origin pending inputs are swept safely during auto-pause and drained exactly once after manual success
- **Repeated error card grouping** -- Consecutive identical chat error cards collapse into counted cards without changing backend recovery behavior

### Changed

- **Takode-only changelog history** -- The active changelog now stops at the Takode `2026-04-10` baseline instead of rendering inherited upstream Companion releases

## 2026-05-22

### Added

- **Quest commit evidence** -- Quest Detail can show readable code and memory commit evidence, with commit diff access from the quest surface

### Fixed

- **Recoverable disconnects** -- Recoverable backend disconnects now appear as quieter feed and Session Info status controls with Resume/Retry actions
- **Codex queued input wakeups** -- Disconnected Codex sessions now wake for queued model-bound inputs, including leader herd events and board-stall warnings
- **Needs-input resolution delivery** -- Externally resolved needs-input notifications are delivered as deferred, model-visible notices on the next eligible direct message
- **Voice transcription context** -- Thread-scoped transcription now keeps useful older Main-thread context when recent activity is mostly tool or system noise
- **Global needs-input navigation** -- Needs-input menus include clearer destination controls and dismiss large overlays when navigation would otherwise be obscured
- **Blocking UI navigation** -- Quest and session navigation actions dismiss blocking overlays when the target session or quest is opened
- **Diff viewer stability** -- Full diff views preserve horizontal scrolling and render expanded unchanged lines without blank gaps
- **Mobile chat controls** -- Mobile thread status chips, collapsed composer controls, and chat-feed spacing fit more cleanly on narrow screens
- **Leader quest diffs** -- Leader quest tabs open the associated worker diff instead of defaulting to the leader worktree when a worker target is available

### Changed

- **Leader proposal guidance** -- Leader proposal instructions now keep chat approval surfaces concise while detailed worker grounding stays in the quest record

## 2026-05-21

### Added

- **Server-backed shortcut settings** -- Keyboard shortcut settings now persist through the server, migrate from legacy browser storage, and keep the standard search shortcut clear of browser find
- **Leader hover active quests** -- Leader session hover cards now show active quest rows and phase labels for faster orchestration triage

### Fixed

- **Needs-input voice retry** -- Failed needs-input voice answers keep their recording context and offer a compact retry/dismiss path
- **Global needs-input menu** -- Cross-session needs-input details are easier to read and stale cached notifications are reconciled before prompts stay visible
- **Leader quest tabs** -- Leader quest-thread tabs preserve order during route repair, active-row updates, and repeated route processing
- **Queued wait status** -- Active thread banners integrate queued wait status more consistently
- **Mobile feed stability** -- Mobile chat feed and Work Board overflow animations avoid layout jumps
- **Codex launch reliability** -- Codex launch and relaunch paths preserve preflight checks, timing, and intentional-relaunch state more consistently

### Changed

- **Quest Journey guardrails** -- Board and Journey tooling now enforces User Checkpoint skip rules and makes Memory, source, and TLDR handoff guidance clearer

## 2026-05-20

### Added

- **Sidebar Session Space controls** -- Sidebar Session Spaces can show configurable session counts with a "more" overflow control, and Universal Search can find sessions directly
- **Changelog viewer** -- Settings can open the repository changelog in-app from the server diagnostics section

### Fixed

- **Worker file-link routing** -- Worker file links are resolved before phase handoff text is shown to users
- **Quest Journey lifecycle rows** -- Quest tabs show Journey started and completed lifecycle rows in the owner thread
- **Quest thread wait banners** -- Quest thread banners show board wait targets, including queued sessions, quests, and user-input references
- **Server restart recovery** -- Restart recovery now reconnects sessions on demand when queued work or backend delivery needs a backend
- **Image file-link previews** -- Markdown image file links now render previews by default
- **Review and outcome notifications** -- Review notifications stay scoped to the correct tab, multi-quest review tabs clear more reliably, and thread outcome reminders preserve needs-input state
- **Codex leader recovery diagnostics** -- Exhausted Codex leader recovery now surfaces a clearer failure state instead of disappearing into generic recovery noise

### Changed

- **Landing page cleanup** -- The obsolete standalone landing site was removed from the app repository
- **Dependency security** -- The Anthropic SDK dependency was updated to remediate its advisory
- **Memory catalog output** -- `memory catalog show` output is more compact and separated for faster scanning

## 2026-05-19

### Added

- **Voice answers for needs-input** -- Needs-input prompts can be answered with voice input, including recording state and transcription progress feedback

### Fixed

- **Voice transcription delivery** -- Voice results are delivered over WebSocket more reliably, lightbox Escape no longer triggers voice shortcuts, and transcription completion state is clearer
- **Work Board stability** -- Completed quest history is preserved during cleanup, stale done rows are cleared, worker feed boundaries stay scoped, and tab hover geometry is steadier
- **Memory browsing and defaults** -- Memory spaces are backfilled for existing sessions, default routing is more consistent, and diff panes scroll horizontally

### Changed

- **Quest review checkpoints** -- User review checks and memory handoff wording are clearer across Journey phases

## 2026-05-18

### Fixed

- **Notification routing** -- Needs-input notifications keep thread ownership and fallback route inference more reliably
- **Terminal file previews** -- File-read tool previews in terminal output are easier to inspect
- **Codex orphan diagnostics** -- Orphaned custom-tool output is classified and preserved so multi-call failures are easier to recover

## 2026-05-17

### Fixed

- **Universal search event results** -- Universal Search handles event-style results more reliably
- **Offline composer tools** -- Local composer tools remain available while a session is disconnected
- **Thread status display** -- Thread status chips sit in the turn footer with tighter spacing and more reliable collapse behavior
- **Session recovery and navigation** -- Queued sends survive disconnects, startup recovery suppression has a fallback, and navigation can load older target messages
- **Needs-input attention counts** -- Sidebar and document-title needs-input counts stay aligned

## 2026-05-15

### Fixed

- **Codex resume behavior** -- User-only resume turns retry after stale disconnects, and merely opening a browser no longer triggers passive recovery
- **Memory session defaults** -- Memory defaults follow the session group more consistently when sessions are created or replaced

## 2026-05-13

### Fixed

- **Theme contrast** -- Notification chips, Quest panels, Work Board rows, and dense dark-theme surfaces have stronger contrast
- **Codex recovery limits** -- Adapter recovery limits are clearer when a recovery path is exhausted

## 2026-05-12

### Fixed

- **Work Board tab hover** -- Thread tabs stay stable when hovered
- **Needs-input collapsed previews** -- Collapsed feed previews show needs-input context more clearly

## 2026-05-11

### Added

- **Memory update diffs** -- The Memory view can inspect recent committed memory updates with file lists and inline diffs

### Changed

- **README orchestration overview** -- The README now leads with Takode orchestration, Quest Journeys, Memory, direct sessions, integrations, and updated product screenshots

### Fixed

- **Memory view chrome** -- Memory navigation and layout controls are cleaner, including a clearer sidebar icon
- **Memory session-space defaults** -- Memory CLI, spawned sessions, and replacement sessions resolve session-space defaults more consistently
- **Codex pending-turn recovery** -- Pending Codex turns recover more reliably after interrupted refreshes

## 2026-05-10

### Added

- **Final Memory Journey phase** -- Quest Journeys now include a dedicated final Memory phase for durable handoff decisions

### Fixed

- **Thread status and windows** -- Thread status chips stay in feed flow, and leader thread windows survive history refresh and session removal more reliably
- **Leader Work Board controls** -- Work Board controls and summaries are more polished and easier to scan
- **Quest session links** -- Quest detail and search links route to the right session context

## 2026-05-09

### Added

- **Shared image preview variants** -- Image attachments now have reusable preview variants and refreshed variant responses so chat and Questmaster previews load more consistently
- **Universal search quest actions** -- Universal search can surface quest actions directly, and composer-launched searches keep the current query available
- **Audited quest ownership reassignment** -- Quest ownership changes are tracked explicitly so leader handoffs and owner corrections are easier to audit
- **Diff-stat budget guards** -- Git diff metadata refreshes are bounded for large or dirty worktrees, reducing UI stalls while preserving useful status signals
- **Voice activity history** -- Voice input keeps a rolling level history for steadier recording feedback
- **Quest feedback editing and progress TLDRs** -- Quest feedback can be edited, and quest preview progress now includes TLDR context for faster scanning

### Fixed

- **Quest search ranking** -- Fresh, exact quest matches are easier to find in Questmaster search results
- **Needs-input navigation** -- Needs-input notifications include clearer source context and route to the right thread or tab more reliably
- **Leader Work Board access** -- Work Board controls, title alignment, mounted quest panels, active phase chips, and route state stay consistent across leader navigation
- **Thread status stability** -- Thread status chips, thread filters, close targets, shortcut routing, and scroll restoration survive history refreshes and tab switches more reliably
- **Voice transcription and indicators** -- Voice context includes visible leader messages, SSE transcription results resolve correctly, and level meter styling is more consistent
- **Session restart and Codex metadata recovery** -- Restart blockers recover cleanly, restart timeout success is clearer, and Codex metadata refreshes coordinate with active turns
- **Reminder and image polish** -- System reminders render as standalone chips, quest detail image previews are tighter, native select popups respect dark mode, and mobile sidebar portraits are ready sooner

### Changed

- **Takode inspection output** -- CLI and thread inspection commands preserve thread context while keeping grep, peek, and default hints explicit and compact
- **Codex session safety guidance** -- Codex metadata refresh and skill-change behavior are documented as a reusable project skill for future session-safety work

## 2026-05-08

### Added

- **Universal message search** -- A mode-scoped universal search overlay can search sessions, threads, messages, and quests, with backend message search and composer entry points
- **File-link actions** -- File links gain context-menu actions backed by a server-side resolver
- **Backend logo badges** -- Backend badges and refreshed app logo assets make active backend and app branding more legible across themes
- **Configurable voice shortcuts** -- Voice controls can be assigned through the shortcut system
- **Paused-session composer bypass** -- The composer can send through selected paused sources when a user intentionally bypasses pause state

### Fixed

- **Mobile voice progress** -- Mobile transcription shows clearer progress, timing, and retry state while recording or uploading
- **Notification source context** -- Needs-input notifications preserve source context in global menus, replies, and seeded Playground scenarios
- **Thread and injected-event routing** -- Thread status markers no longer route whole messages, interrupted outcome reminders are skipped, and injected prompts render as searchable event messages
- **Session and git refresh costs** -- New sessions avoid implicit git sync, session-list polling is decoupled from git refresh, and git metadata scans are bounded more consistently
- **Archived worktree cleanup** -- Archived worktree removal can force cleanup when normal deletion paths leave stale state behind
- **Quest and memory browsing responsiveness** -- Quest page search stalls are reduced, and memory record detail layouts are more balanced
- **Session metric recovery** -- Turn metrics are derived from history and preserved across Codex init paths more reliably

### Changed

- **Memory browsing surface** -- The memory browser was redesigned around denser navigation, clearer record details, and better use of available space
- **Search placement** -- Session search moved into the sidebar while universal search handles cross-mode discovery
- **Validation guidance** -- UI validation guidance now distinguishes worktree code changes from the shared persistent validation state

## 2026-05-07

### Added

- **Global needs-input menu** -- Pending needs-input prompts can be reviewed globally, answered in place, and delivered back to the owning thread more reliably
- **Memory view** -- The old streams surface was replaced with a memory-focused browsing view
- **Permission mode CLI commands** -- Permission mode can be inspected and changed from the Takode CLI with backend-native mode validation
- **Leader portrait pools** -- Settings include built-in leader portrait pools with picker and row display support
- **Worker replacement spawn** -- Leaders can reclaim capacity by spawning a replacement worktree worker when an existing worker slot is stuck or unavailable
- **Thread and waiting status markers** -- Threads can show inline ready/waiting status markers, and waiting notifications can be transient when they no longer need attention
- **Emergency pause mode** -- Sessions can enter an emergency pause mode that blocks normal delivery until intentionally bypassed or resumed

### Fixed

- **Codex recovery paths** -- Interrupted assistant-only turns, coalesced skill refreshes, silent command results, and disconnected refresh retries recover without leaving turns stuck
- **Mobile chat viewport** -- Mobile keyboard sizing and root viewport behavior keep the composer and connection banners visible in more cases
- **Notification targeting** -- Blue and amber nudges, hidden tab precedence, repeated outcome reminders, and visible-tab scoping behave more predictably
- **Thread tabs** -- Active quest tabs survive completion, tab scroll targets are preserved, visible tab reordering is restored, and notification surfaces stay visually neutral
- **Questmaster and search precision** -- Fuzzy quest ranking and Unicode search tokens produce more useful results
- **Memory record access** -- Memory reads handle symlinks, sibling spaces, catalog freshness, scrollable space lists, and record detail readability more safely
- **Sidebar and session polish** -- Leader portrait rows are larger, portrait rings show status, session creation labels are clearer, and Session Info controls moved into the title area

### Changed

- **Permission mode handling** -- Permission behavior now uses backend-native modes instead of translating everything through a narrower shared abstraction
- **Takode CLI compactness** -- Session JSON output, injected recovery prompts, and inspection agent labels are more compact for cross-session debugging
- **Reusable orchestration guidance** -- Orchestration and dispatch guidance now better document worker replacement, reusable phase guidance, and design-principle skills

## 2026-05-06

### Added

- **File-based memory foundation** -- Memory repositories can be scoped by server/session space, use explicit lock and commit provenance, and support global CLI options
- **Leader active chip jump** -- Leader active-phase chips can jump directly to the relevant work context
- **Refreshed app icon** -- Takode gained updated app icon assets

### Fixed

- **Sparse thread windows** -- Thread windows fill sparse histories more reliably, and thread markers stay hidden inside collapsed turns
- **Leader voice context** -- Voice transcription context is scoped to the active leader thread instead of leaking unrelated thread context
- **Needs-input replies** -- Inline needs-input replies are decoupled from notification routing so answers arrive in the intended place
- **Codex leader routing** -- Codex leader turns route to the active thread correctly and recycle leaders more safely when context is exhausted
- **Thread tab layout** -- Desktop tabs have more room before overflowing, completed tab titles are muted, and quest completion markers persist in the sidebar
- **Memory repository setup** -- Memory repos reject colliding slug renames and use simpler frontmatter and auto-init behavior

### Changed

- **Quest Journey phase delivery** -- Runtime Journey phase briefs replaced legacy phase skill aliases so phase guidance follows the active workspace
- **Leader proposal guidance** -- Orchestration guidance now avoids duplicated quest proposal scope in common dispatch flows

## 2026-05-05

### Added

- **Multi-question needs-input prompts** -- Needs-input notifications can carry multiple short questions in a single user decision surface
- **Work Board overflow menu** -- Leader Work Board tabs gain an overflow menu when active work exceeds the visible tab rail
- **Memory guardrail groundwork** -- Memory-related bookkeeping can surface cleanup candidates and active-run guardrail checks

### Fixed

- **Session names and status chips** -- Manual session renames are preserved across namers, and git status chips refresh after session switches and surface refresh failures
- **Leader thread tabs** -- New leader tabs stay leftmost, stale board tabs remain in place, and tab dragging is constrained to the rail
- **Leader feed paging** -- Large leader histories page in batches, and historical error banners anchor to the right feed position
- **Codex and herd recovery** -- Queued Codex leader events, stale terminal live state, and incomplete resumed-turn recovery no longer block later work
- **Search result routing** -- Grouped search results and threaded message routes stay connected to the correct destination
- **Questmaster copy controls** -- Compact quest copy controls align more cleanly with the surrounding table UI

### Changed

- **Shared validation state guidance** -- UI validation guidance now defaults to the shared persistent E2E state when that state is appropriate

## 2026-05-02 to 2026-05-04

### Added

- **Quest Journey release blog** -- Added a concise product overview of the redesigned leader orchestration experience: [Takode's reimagined leader orchestration system](docs/release-notes/quest-journey-redesign.md)
- **Server-backed leader thread windows** -- Leader quest tabs, selected thread windows, and thread route indexes now have stronger server-side foundations so large orchestration sessions can keep focused quest conversations available across reloads and reconnects
- **Leader tab reordering** -- Quest thread tabs can be reordered, making active multi-quest sessions easier to organize

### Fixed

- **Quest-thread conversation reliability** -- Attached source messages, Main-thread notification sources, handoff markers, active output, and selected quest threads now stay visible in the right conversation more consistently
- **Leader feed performance** -- Large leader sessions avoid more cold-load hangs, dense activity bursts collapse more cleanly, and feed windows keep bounded ledgers instead of rebuilding unnecessary history
- **Journey readability** -- Long Journey timelines and hover previews are clamped, queued wait reasons are shown in quest hovers, and Journey lifecycle rows stay quieter until they matter
- **Codex tool failure recovery** -- `write_stdin` router failures and stale pending delivery states are surfaced and recovered as scoped tool failures instead of turning into whole-session failures
- **Thread viewport restoration** -- Leader threads restore saved positions more reliably after tab switches, feed remounts, and server-window updates
- **Leader thread and board edge cases** -- Thread activity indicators, repeated active phase rows, and selected-thread window retries behave more reliably

### Changed

- **Final debrief hygiene** -- Quest completion now expects final debrief metadata and TLDRs so completed work remains easier to scan later
- **Feed debugging guardrails** -- Message-feed and thread-window work now has clearer debugging rules for windowed histories, source-message attachment, and large leader-session performance
- **Validation profile guidance** -- Takode UI validation guidance now better documents profile choice, state retention, and evidence expectations

## 2026-04-25 to 2026-05-01

### Added

- **Quest Journey orchestration overhaul** -- Quest work now moves through visible, revisable Journey phases with leader-proposed plans, phase notes, active Work Board state, repeated phases, and clearer handoffs between workers, reviewers, user checkpoints, and porting
- **Focused quest threads** -- Leader sessions can keep Main as the staging and overview thread while routing detailed quest discussion, worker handoffs, reviewer updates, and relevant attached context into focused per-quest threads
- **Work Board navigation** -- The Work Board gained Journey previews, phase status, compact thread navigation, cross-thread activity markers, active wait states, and mobile-friendly quest-thread selectors
- **Quest memory and TLDR records** -- Quest records now support phase-scoped documentation, TLDR metadata for long feedback, final debrief metadata, phase documentation summaries, phase note image thumbnails, phase durations, and explicit follow-up relationships
- **Validation and coordination tooling** -- Added global resource leases, a Takode UI validation skill, optimized agent-browser screenshots, worker-stream checkpoints, and clearer orchestration guidance for long-running multi-session work
- **Questmaster browsing improvements** -- Questmaster gained compact table sorting, paged browsing, relevance search fixes, richer hover previews, leader attribution, and lower-friction new-quest drafting
- **Session and settings polish** -- Added custom transcription model support, persisted new-session defaults, scrollable model dropdowns, and clearer session-space creation flows

### Fixed

- **Leader and notification routing** -- Needs-input waits, notification chips, suggested answers, review notifications, and herd events now stay better scoped to the owning leader thread and survive restarts more reliably
- **Quest thread projection stability** -- Thread markers, moved-message counts, routed notifications, attachment sources, hidden activity markers, and source handoff markers now preserve context without creating confusing gaps in Main
- **Questmaster reliability** -- Live quest-store migration, snapshot freshness checks, claim/list performance, completed Journey status, compact statuses, TLDR keyboard access, and mobile quest detail layouts were hardened
- **Codex leader reliability** -- Codex leader sessions handle wrapper homes, model catalogs, auth/cache seeding, recycle thresholds, transient init recovery, session auth freshness, and stale post-compaction relaunch state more consistently
- **Restart and recovery behavior** -- Restart-interrupted sessions, queued work, sidebar notification state, stale attention markers, recovered leaders, and in-flight herd delivery recover with fewer duplicated or lost signals
- **Journey proposal safety** -- Active Journey proposals reject invalid promotions, preserve note rebasing semantics, block unsafe active rewrites, and keep runtime phase briefs aligned with the session workspace
- **UI readability** -- Quest hovers, thread tabs, quest banners, Work Board banners, phase notes, completed quest tabs, and compact reminder rendering were tightened for dense orchestration views

### Changed

- **Phase guidance and workflow docs** -- Journey guidance now treats Alignment, Explore, review, Execute, Outcome Review, User Checkpoint, Bookkeeping, and Port as explicit orchestration stages with clearer ownership and documentation expectations
- **Project skill organization** -- Project skills were consolidated into the `.agents` runtime path for Codex-facing sessions, legacy aliases were preserved where needed, and obsolete Playwright E2E guidance was replaced by the Takode UI validation workflow
- **Quest verification model** -- Quest verification moved into the done/review flow, with human-checkable verification items and debrief records replacing older separate verification surfaces

## 2026-04-24

### Added

- **Configurable app shortcuts** -- Settings now includes shortcut presets, custom recordable bindings, and per-action `Off` states for app navigation
- **Session Info editor actions** -- Session Info can open the active working directory in the configured editor, with long worktree/base paths kept scrollable and copyable
- **Leader needs-input reminders** -- Leader sessions are reminded about unresolved same-session needs-input notifications before handling new direct user messages

### Fixed

- **Archived session cleanup** -- Archived sessions without worktree tracker mappings can now be deleted cleanly
- **Shortcut navigation reliability** -- Search, session switching, terminal navigation, and terminal-to-thread returns now follow visible sidebar state and preserve thread viewport more consistently
- **Session preview and Questmaster polish** -- Session message previews, quest deep-link scrolling, and oversized MessageFeed test coverage were repaired and reorganized
- **Codex recovery and replay costs** -- Codex orphaned tool-preview recovery now waits for the watchdog window, and persisted replay buffers are sanitized to avoid hot-tail and metric memory spikes

## 2026-04-23

### Added

- **Codex status command support** -- Codex sessions now support `/status` turns without leaving stale active-turn state behind
- **Interactive session model controls** -- Session info now includes model and reasoning-effort selectors, with worker sessions inheriting leader model choices
- **Session search improvements** -- Multi-word search, assistant text response search, and search-data-only archived restore make older context easier to find
- **Takode read pairing** -- Tool call results are paired with their inputs in `takode read` for clearer cross-session inspection

### Fixed

- **Codex safety and MCP handling** -- Restored safe heredoc auto-approval patterns, MCP elicitation approvals, Codex config model defaults, and committed user-message IDs
- **Permission approval routing** -- Plan approvals, sensitive auto-approval bypasses, oversized staged-file checks, and stale pending permission state now behave more reliably
- **VS Code context sync** -- Editor selection context now survives restarts, forwarded URLs, closed panels, background updates, and mobile composer layout constraints
- **Herd and reconnect reliability** -- Archived sessions are skipped during restart bootstrap, reviewer sessions detach cleanly, and stale pending permissions are cleared across reconnect paths
- **Questmaster workflow reliability** -- Quest search state, commit metadata, rich-text inputs, and summary guidance are preserved more consistently across navigation and status transitions

## 2026-04-22

### Added

- **Stable message links** -- Chat messages can be copied as stable links for easier handoff and review
- **Self-managed notifications** -- Sessions can resolve their own Takode notifications, reducing stale attention signals
- **Playground section navigation** -- Playground examples now support route-safe section navigation

### Fixed

- **Attachment send reliability** -- Uploaded attachments are not resent, image attachments are preprocessed before send, and Codex draft image state is restored
- **Herd and notification cleanup** -- Delivered needs-input notifications resolve correctly, herded notification chips stay scoped to their owning leader, and stale board stall injections are reduced
- **Quest and CLI rich text safety** -- Quest feedback, spawn inputs, and copied CLI text preserve shell-sensitive content literally
- **Board and plan flow reliability** -- Dispatch reminders, resolved wait conditions, pending plan rejection, and plan rejection rendering behave more consistently
- **Dev and wrapper startup** -- Dev-start services stay alive after bootstrap, global CLI wrappers are simpler, and server ownership of wrappers is isolated
- **Mobile and composer polish** -- Mobile user-turn controls, footer layout, selection-menu behavior, and voice transcription responsiveness were improved

### Changed

- **Refactor verification guardrail** -- Refactor work now documents the full typecheck, test, and format verification gate
- **Architecture documentation** -- Server architecture notes were updated to match the post-refactor code structure

## 2026-04-21

### Fixed

- **Worktree archive/creation timeouts** -- Worktree setup and archive operations no longer block the event loop on NFS, preventing cascading WebSocket disconnects
- **Voice mode persistence** -- Voice mode preference persists across sessions without hydration races
- **Image upload ordering** -- Attachments are now uploaded before the message is sent
- **Stale Codex recovery state** -- Cleared stale queued recovery state that could block Codex turn delivery

### Changed

- **Module boundary refactors** -- Oversized server, bridge, composer, message feed, and store modules were split into focused files without changing user-facing behavior

## 2026-04-20

### Added

- **Timer event cards** -- Timer messages render as collapsed event cards in the chat feed instead of plain text rows
- **Composer autocomplete for refs** -- Typing `q-` or `#` in the composer autocompletes quest IDs and session numbers

### Fixed

- **False "server unreachable" banner** -- Suppressed spurious unreachable banner that appeared while the chat was actively connected and streaming
- **Transcription upload feedback** -- Upload and acknowledgement phases now show progress before speech-to-text completes
- **Notification chip layout** -- Per-type chip counts, flattened layout, and compact mobile inbox review rows
- **Worktree diff totals** -- Cleared stale diff totals for worktrees that are not ahead of their base branch
- **Codex image follow-ups during streaming** -- Queued image follow-ups are no longer dropped during active streaming
- **Worktree settings preservation** -- Tracked Claude settings files are preserved in worktrees
- **Timer event row layout** -- Flattened timer event rows to prevent misaligned cards in the chat feed

## 2026-04-19

### Added

- **Grep-style quest search** -- `quest grep` provides ripgrep-style search across all quest content with match highlighting
- **Pushover event filters** -- Pushover push notifications can be filtered by event type (e.g. only needs-input, only review-ready)
- **Stalled board row warnings** -- The work board warns when queued rows appear stalled, helping leaders spot stuck workers
- **Table viewer overlay** -- Markdown table viewer uses a wider overlay for better readability

### Fixed

- **Mobile composer and navigation** -- Reply composer stays expanded on mobile, status chips no longer overlap the mobile nav bar, and WebSocket reconnect sockets recover correctly on mobile
- **Voice mode on mobile** -- Mobile composer stays open while recording (q-282)
- **Codex image attachments** -- Hardened the full image attachment flow: send stages are visible, queued follow-ups survive overlap, and image send status shows in the purring chip
- **Markdown numbered lists** -- Numbered lists continue correctly across interleaved bullet sublists
- **Codex compaction with VS Code context** -- Fixed compaction failing when the Codex session included VS Code context blocks
- **Compaction recovery prompts** -- Force-compact no longer drops recovery prompts; improved recovery prompt wording after compaction
- **Herd wakeup delivery** -- Fixed replay-deferred herd wakeups not being delivered after session reconnect
- **Duplicate Codex relaunch** -- Prevented double relaunch when injected prompts arrived on a dead Codex socket
- **Link result previews** -- Takode links now show result previews for successful (not just failed) tool calls
- **Board queued dependents** -- Restored queued dependents are now correctly preserved when board state is recovered

### Changed

- **Active timers page** -- The scheduled-messages page has been repurposed to show active session timers with live countdown chips
- **Timer sidebar icons** -- Idle sessions with active timers show a timer icon; icon state syncs with timer lifecycle
- **Board docked state** -- The docked work board remembers its open/closed state across page loads
- **Session-group creation defaults** -- The session-group creation dialog remembers your last-used defaults (backend, model, etc.)
- **Removed legacy linear session view** -- The old linear session list in the sidebar has been removed in favor of the grouped view
- **Questmaster copy IDs** -- Quest IDs can now be copied directly from quest detail views
- **Editor selection chip UX** -- Improved the backend/model selector chip interaction in the composer

## 2026-04-18

### Added

- **History windowed sections** -- Long message history sections are windowed on demand to reduce rendering cost
- **Quest commit diff totals** -- Quest detail views show synced commit diff totals for at-a-glance change size
- **Work board ordering and columns** -- Board items are now ordered by status and dependencies, with reordered columns and clearer status labels
- **Cross-linked quest and session hovers** -- Quest and session hover cards are cross-linked for faster navigation
- **Orchestration visibility improvements** -- Improved board output, scan probe, and message-link hover rendering
- **Work board original command** -- Board rows now show the original board command used to create them

### Fixed

- **Markdown wide tables** -- Wide tables now expand properly instead of being clipped
- **Quest images** -- Quest images open in a lightbox modal instead of navigating away
- **Board resolved deps** -- Cleared resolved wait-for dependencies that were persisting incorrectly
- **Board status labels** -- Inline status labels are now properly formatted
- **Codex stall disconnects** -- Surfaced Codex stall disconnects to orchestration so leaders can react
- **Worktree detailed diffs** -- Anchored worktree detailed diffs to the correct base
- **Todo list rendering** -- New task lists now appear immediately without requiring a refresh

### Changed

- **Completed row timestamps** -- Completed board rows now show when they were completed

## 2026-04-17

### Added

- **Terminal inspector drag and resize** -- The terminal/tool inspector panel is now draggable and resizable
- **Session search category filters** -- Search results can be filtered by category (messages, tools, quests, etc.)
- **Herd event session chip links** -- Session chips in herd events are now clickable, linking directly to the session
- **Timer indicator on session chips** -- Sidebar session chips show a timer indicator when the session has active timers

### Fixed

- **Diff viewer for new files** -- Content-only new file edits now render correctly in the diff viewer
- **Codex view_image tool blocks** -- Raw `view_image` tool blocks are now surfaced in the chat feed
- **Quest session numbers** -- Session numbers are now shown in quest detail views
- **Quest lifecycle naming** -- Quest lifecycle naming order is preserved in the bridge

### Changed

- **Journey status labels** -- Questmaster journey status labels are now styled distinctly

## 2026-04-16

### Added

- **Negated quest search** -- Quest search supports negated filters (e.g. `-tag:ms` to exclude a tag)
- **Quest summary comments** -- Quest verification now enforces a summary comment before submission
- **Quest synced commits on verification** -- Verification handoffs automatically attach synced commit SHAs
- **Browser perf collector** -- Client-side performance metrics are collected for debugging render bottlenecks

### Fixed

- **Markdown single newlines** -- Single newlines are now respected in the shared Markdown renderer
- **Codex message delivery after restart** -- Unblocked stuck Codex message delivery after server restart (q-385)
- **Codex image send order** -- Image send order is preserved for multi-image messages
- **Quest title auto-renames** -- Leaders can no longer accidentally rename quest titles
- **Spurious restart interruptions** -- Suppressed spurious restart interruptions in the WebSocket bridge
- **Mobile transcription timeout** -- Extended mobile transcription timeout to avoid premature cutoffs
- **Composer re-render churn** -- Reduced composer re-renders during rapid session churn
- **Diagnostics section visibility** -- Task panel diagnostics section stays visible when it should

### Changed

- **Codex continued turn merging** -- Codex continued assistant turns are now merged in the chat feed
- **Leader archive confirmation** -- Archiving a leader with an active herd now requires confirmation
- **Reviewer-groom guardrails** -- Tightened reviewer-groom workflow guardrails for more consistent reviews

## 2026-04-15

### Added

- **Timer titles and descriptions** -- Session timers now support separate titles and descriptions
- **Force herd reassignment** -- Leaders can forcibly reassign a herded session to a different worker
- **Bell urgency coloring** -- The notification bell icon color reflects the highest-urgency unread notification
- **Herd event activity compression** -- Repetitive tool-use activity in herd events is compressed to reduce noise

### Fixed

- **Compaction recovery** -- Suppressed false Claude compaction recovery and replayed compaction recovery noise (q-317)
- **Codex image transport** -- Restored native localImage transport for image messages (q-322)
- **Worktree branch on archive/unarchive** -- Worktree branches are archived as lightweight refs and restored correctly on unarchive (q-329)
- **Re-render reduction** -- Reduced unnecessary re-renders from polling and event floods across sidebar, composer, and shell store (q-334)
- **Codex disconnect recovery** -- Hardened disconnect recovery and diagnostics for Codex sessions
- **Subagent state on history sync** -- Reset stale subagent state when history is re-synced from the server
- **Quest comment composer** -- Quest comment composer stays visible when scrolling
- **Codex config on relaunch** -- Global Codex config is refreshed on session relaunch
- **Codex denied-plan guard** -- Preserved denied-plan fresh-turn guard across session state changes
- **False notify chips** -- Eliminated false notification chips that appeared without real events

### Changed

- **Reviewer-groom workflow** -- Reworked reviewer-groom workflow for more consistent reviews
- **Mobile log viewer** -- Improved mobile log viewer usability with fully collapsible filters (q-330)

## 2026-04-14

### Added

- **FolderPicker redesign** -- Rebuilt with breadcrumb navigation, inline filter, and full keyboard navigation (q-315)
- **Production logging system** -- Server-side production logging with a mobile-friendly log viewer (q-299)
- **Auto-collapse plan file writes** -- Plan-file tool writes are auto-collapsed in the chat feed to reduce noise (q-314)
- **AskUserQuestion send button** -- The "Other" free-text input in AskUserQuestion now has a send button (q-319)
- **Edit and delete agent feedback** -- Questmaster feedback entries from agents can now be edited or deleted inline

### Fixed

- **Streaming lag from Composer re-renders** -- Narrowed Composer store selectors to prevent lag during streaming (q-265)
- **Notification and timer chip alignment** -- Notification and timer chips are now on the same line (q-309)
- **Horizontal scroll in chat** -- Prevented horizontal scrolling in the chat feed (q-313)
- **Stuck session detection** -- Robust detection and recovery of stuck sessions with extracted shared threshold constant (q-307)
- **Permission mode across SDK init** -- `permissionMode` is now preserved across SDK `session_init` events (q-316)
- **Diff base branch persistence** -- Worktree diff base branch survives server restarts (q-318)

### Changed

- **Review chip checkbox** -- Review notification chips now show a checkbox affordance (q-302)

## 2026-04-13

### Added

- **Session rollback / revert** -- Codex sessions now support reverting to a previous message, safely exposed via the UI (q-289)
- **Session message size hover card** -- Session details popover shows message history size in the hover card so users can gauge API limit proximity (q-291)
- **Pending session timers** -- `takode list` and the sidebar show active timers on sessions, giving leaders visibility into scheduled work
- **Notification chips in collapsed turns** -- Collapsed assistant turns show notification chip counts so important events stay visible (q-277)
- **Token-efficient scan/peek format** -- `takode scan`/`peek` JSON output is optimized for lower token usage (q-287)
- **Takode timer enforcement** -- System prompt enforces `takode timer` over `sleep`/`ScheduleWakeup` for waits over 1 minute (q-303)
- **Mandatory notify summary** -- `takode notify` now requires a summary argument (q-304)

### Fixed

- **Herd event pending delivery** -- Unblocked herd-event pending delivery (q-275)
- **Codex image transport** -- Switched to path-only image transport (q-298)

## 2026-04-12

### Added

- **Notification inbox** -- Per-session notification inbox collects `takode notify` events into a persistent, browsable popover with message links, hover previews, and done/active sections (q-235, q-242)
- **Work board completed history** -- Board items now move to a collapsible "Completed" section instead of being deleted, preserving work history (q-238)
- **Archive Group** -- One-click context menu action to archive an entire orchestration group (leader + workers + reviewers) (q-231)
- **Message history size** -- Session details popover now shows message history size in MB/KB for visibility into API limit proximity (q-236)
- **Compaction events in scan/peek** -- Compaction markers now appear in `takode scan`/`peek` output and are indexed for session search (q-247)
- **Pre-submission checklist** -- Workers must now address all human feedback, add a summary comment, and only include human-verification items before submitting quests (q-248)
- **Leader notification trigger rules** -- Explicit guidance on when to use `takode notify` for needs-input and review-ready events (q-246)
- **Quest journey enforcement** -- Leader guardrails now prohibit skipping review/groom stages regardless of change size (q-241)
- **Leader "wait for user answer" rule** -- Leaders persist the rule to wait for user answers across compaction (q-240)
- **Leader "no blocking tools" rule** -- Leaders are prevented from using AskUserQuestion/EnterPlanMode which would stall herd event processing (q-234)

### Fixed

- **Stale context usage after compaction** -- Context usage percentage no longer shows a stale pre-compaction value; removed incorrect `pre_tokens` context update from all three compact_boundary handlers (q-250)
- **Stuck reviewer sessions** -- Fixed reviewer sessions showing as "generating" indefinitely after completing their skeptic review (q-237)
- **Duplicate compaction markers** -- Fixed /compact after revert producing two separate compaction markers with different summaries (q-227)
- **Grep BRE warning** -- `takode grep` now warns when `\|` BRE alternation syntax returns zero results, suggesting JS/ERE `|` instead (q-229)

### Changed

- **Cleaner chat timestamps** -- Removed centered minute marks and moved generation duration inline with message text (q-249)
- **Unified quest detail modal** -- Replaced lightweight in-chat quest modal with the full Questmaster detail view everywhere (q-239)
- **Image compression on ingest** -- PNG screenshots are now converted to JPEG q85 when stored, reducing image size by ~22% with no visible quality loss (q-232)
- **Improved herd event formatting** -- Cleaner turn_end summaries with quoted content, separate tool lines, and restored permission icons (q-245)
- **Image reading rule** -- Sessions now try reading images directly first and only resize on failure (q-243)

## 2026-04-11

### Added

- **Session-message deep links** -- Deep-link to specific messages within sessions with auto-expand of collapsed containers and scroll-to-reveal with amber highlight (q-201)
- **User message Markdown** -- User messages now render with a conservative Markdown subset (code fences, bold/italic, lists, links) instead of plain text (q-216)
- **CamelCase fuzzy search** -- Searching "plan mode" now matches "ExitPlanMode" by splitting CamelCase tokens across all search surfaces (q-224)
- **Leader-dispatch dedicated skill** -- Extracted leader dispatch workflow into a dedicated skill so critical dispatch rules survive compaction (q-214)
- **Plan content in herd events** -- ExitPlanMode herd events now include the full plan text so leaders can review plans inline (q-215)
- **Session number in system prompt** -- Sessions receive their Takode session number for self-referencing during orchestration (q-197)
- **Session info after herding** -- `takode herd` now prints full session metadata after herding (q-192)
- **Pending permission markers** -- `takode list --herd` shows a visible indicator next to sessions with unresolved permission requests (q-222)
- **Board --wait-for session numbers** -- Work board's `--wait-for` flag now accepts `#N` session numbers in addition to `q-N` quest IDs (q-219)

### Fixed

- **Unified image handling** -- Both WS and SDK backends now send user images as file path annotations instead of inline base64, reducing API request size (q-223)
- **Session stalls after restart** -- Fixed SDK and WebSocket sessions stalling after server restart due to generation lifecycle tracking issues (q-220)
- **History sync on reconnect** -- Fixed browser receiving no history on WebSocket reconnect by falling back to full history delivery on frozen hash mismatch (q-212)
- **Stale running state after relaunch** -- Fixed UI showing 'running' state after a WS session turn completes on relaunch (q-213)
- **Permission routing to leader** -- Fixed permission requests from herded WebSocket sessions not being delivered as herd events to the leader (q-205)
- **WS auto-approval in ask=off mode** -- Fixed WebSocket sessions not auto-approving permission requests in `ask=off` mode (q-204)
- **Stale worktree guardrails** -- Fixed stale `.claude/CLAUDE.md` worktree guardrails conflicting with dynamic system prompt injection (q-211)
- **Context usage double-counting** -- Fixed incorrect context usage percentage for WS and Codex sessions by consolidating cache-detection logic (q-208)
- **Reverted messages reappearing** -- Prevented stale reverted messages from resurfacing after server restart (q-225)
- **WS interrupt error suppression** -- Fixed spurious error side-effects during WebSocket session interruption (q-202)
- **Herd event chip overflow** -- Constrained herd event chip width to prevent horizontal scroll (q-226)
- **Clickable tool result images** -- Tool result image previews now open in a lightbox modal (q-199)
- **Diff expand between hunks** -- Enabled expand buttons to reveal collapsed code between diff hunks in unified-diff view (q-122)
- **Peek/scan output formatting** -- Improved readability with tool call prefixes and multi-line continuation symbols (q-203)
- **Queued message flush on resume** -- Deferred queued message flush until --resume replay completes (q-209)
- **Leader prompt lifecycle** -- Fixed stale file references after leader-dispatch skill split (q-218)
- **Selection menu regression** -- Fixed text selection context menu and repositioned to not block selected text (q-174)

## 2026-04-10

### Added

- **Leader session naming** -- Leader sessions are now auto-named "Leader N" with a persistent counter instead of the autonamer (q-188)
- **Standalone file-tool chips** -- Edit/Write/Read tool calls now render as standalone chips with smart-truncated file paths and always-visible Open File button (q-184)
- **Random memory ideas skill** -- New skill for capturing random ideas, notes, and references to Notion

### Fixed

- **System prompt injection for SDK 0.2.101+** -- Fixed system prompt injection for new Agent SDK versions via initialize control_request (both SDK and WebSocket paths)
- **Reviewer sessions in tree view** -- Fixed reviewer sessions not appearing in sidebar tree view herd expansion (q-185)
- **Duplicate notification chips** -- Fixed `takode notify` showing two notification chips instead of one (q-187)
- **Text selection menu** -- Fixed regression and repositioned selection context menu (q-174)
- **Tree view styling** -- Extended accent bar over full herd container, moved status dots to right side, rendered reviewer sessions as inline chips (q-185)

### Changed

- **Agent SDK bump** -- Upgraded `@anthropic-ai/claude-agent-sdk` from 0.2.63 to 0.2.101
- **Removed cron-scheduling skill** -- Replaced by the Takode timer mechanism
- **Collapsed turn timestamps** -- Removed centered minute markers from collapsed turn view for cleaner layout (q-172)
