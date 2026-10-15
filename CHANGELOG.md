# Takode Changelog

## October 2026 release: one Takode across your machines

Until this release, every Takode session ran on the machine that hosted the Takode server. That works until the code you care about lives somewhere else: a cloud workspace, a GPU box, a second computer under your desk. The headline of this release is that one Takode now spans all of them. The server becomes the **coordinator**, which keeps your sessions, quests, work boards and memory in one place, and any machine you register as a **host** can run sessions for it. You keep one browser tab and one session list, and your leaders can start workers wherever the code and the hardware are.

Adding a machine takes two steps: register it with `takode host add` or in Settings → Hosts, then run `takode node` on it. The node dials out to the coordinator, so the host needs no open inbound ports. It signs in with its own token and keeps its own Claude Code and Codex logins. Everything that touches files runs where the files are: Git status, diffs, file previews, worktrees and terminals for a session all run on its machine. The new-session dialog has a machine picker that browses that machine's folders and branches, every remote session carries a chip naming its machine, and a leader can place a worker on a particular machine with `takode spawn --host`. Agents on a host use quests, memory and the Takode commands just as they do locally. All of their reads and writes go through the coordinator, so your data never splits into diverging copies. The [remote hosts guide](docs/remote-hosts.md) walks through the setup, including tunnels and shared machines.

Working across machines also made sessions sturdier everywhere. Sessions now keep running while you restart the Takode server, both on hosts and on the coordinator's own machine, and the restarted server picks them up where they were, pending permission requests included. Restart Server first brings the server's checkout up to date with the branch it tracks, and hosts started with `--auto-update` follow the coordinator onto the new build. When a turn loses its connection to the model API, it now pauses and continues on its own once the network is back instead of failing. If you outgrow a machine, you can move the whole coordinator to another one; the [coordinator move guide](docs/moving-the-coordinator.md) covers rehearsal, cutover and rollback. For reaching Takode from other machines, an optional browser login password guards the app, and a separate token-only host port keeps a tunnel on a shared machine from exposing your server.

The rest of the release is about spending less effort keeping up with your agents. Unsent drafts, including composer text, attached images, comments and half-answered questions, are kept by the server and follow you between your laptop and your phone. An attention list in the top bar gathers every question, Notify Me result and unread result across your sessions, and Next steps through them in priority order. Leader threads show a live preview of the worker they are waiting on, open with a card describing the quest and close with its final summary, and a Board button opens the work board from any thread. Agent activity between messages collapses into compact cards with a one-line summary, and a needs-input question now arrives as an ordinary explanation followed by a short question card, which you can snooze until later. Phone alerts can also go through Web Push, alongside Pushover.

Under the hood, Claude sessions now run only through the Claude Agent SDK, with Claude's native Auto permission mode, a reasoning effort picker and the model list Claude Code itself reports. Teams that share a branch can turn on a landing queue that tests waiting changes together and lands them, so workers are free as soon as they submit. Switching sessions over a slow connection is much faster thanks to compressed traffic and a reused connection. The dated entries below list every notable change.

## 2026-10-14

### Added

- **Reminders about waiting questions** -- When questions stay unanswered while you are away, Takode sends one summary reminder through Pushover and Web Push after 2 hours without activity, then at doubling gaps, at most 3 a day and never during quiet hours (11 PM to 9 AM). Activity means a message, an answer, or a tap or key press in a Takode window; an open screen alone does not count. The reminder opens the attention list, and all of it is configurable in Settings next to the phone alert rules.

### Changed

- **Pages and viewers float over the app** -- The side-by-side mode is retired. Pages, quest details, files and diffs opened from the chat always slide in from the right over the whole app, sized to their content. The app behind stays inert while one is open, Escape closes the top one, and opening a session from quest details or a file closes them.
- **Quest view actions** -- Add Feedback is a filled button on the right, the action row keeps Edit and Delete on the left and the status and Finish Quest on the right, and Delete confirms in place. The manual Assign and Rework buttons are gone. On phones, Open Worker and Open Thread sit in a pinned footer within thumb reach, in the quest view and in the quest preview sheet.

### Fixed

- **Status-bar blur on iPhone** -- iOS no longer leaves its blurred status-bar band over the Home Screen app's top bar after a full-screen preview closes.

## 2026-10-13

### Added

- **Conversation stays loaded under pages** -- Questmaster, Memory, Settings and the other pages open as a view over the current session instead of replacing it, so the conversation stays loaded and comes back instantly at the same scroll position. The address keeps the session and adds the page, and old page links open over the current session.
- **Session settings in the title** -- The session title shows model, effort and access on one line, and a tap opens Session Info, which starts with a settings menu for model, effort, Codex speed and access. Session Info also shows the session's leader, workers or reviewers as chips and its quests, current one first. The composer's separate control row is gone.
- **Recent sidebar view** -- The sidebar can list sessions by most recent interaction across session spaces, each card keeping its herd.
- **Reopening closed quest tabs** -- Find lists a leader's closed quest tabs and reopens them.
- **Microphone choice** -- Voice input can use a microphone chosen while recording, and Takode remembers the order you prefer them in.
- **To-do and proposal links** -- Agents can link a to-do or a to-do proposal in a message. Tapping one opens a preview, where a pending proposal can be approved or rejected, and a small marker shows each link's kind and each proposal's status. Proposals now only add to-dos; agents make changes that cannot lose track of anything (adding text, quest links, Todo or Doing, restoring) directly, and everything else still needs your approval.
- **Recovering sessions after a host moves** -- When a host comes back on a new machine, its sessions relaunch: a missing worktree is recreated on the session's own branch, and a Claude conversation that is gone continues in a fresh one. The session is told what was kept and what was lost before any other input. Each machine can set its worktree folder in Settings → Hosts, so worktrees on storage that outlives the machine survive the move.
- **Host outage alerts** -- When a remote host goes silent, a leader gets one alert per host listing its affected sessions (mid-turn, with input waiting or working an active quest) and a note when the host is back. Messages to a session on an offline host wait for the host instead of being reported delivered, and herd events for a leader on an offline host arrive once it returns.
- **Press feedback** -- Every control responds visibly to a press, buttons that call the server show a pending state, and Send and Reply squish when pressed. A Send press that cannot send now says why next to the button, and a message that cannot reach the server keeps its draft and says so.
- **Web search for Claude on GitHub Copilot** -- Claude sessions served through GitHub Copilot get a working web search tool backed by Copilot's own search, and WebFetch works there too.
- **Changes in the Restart section** -- Settings → Restart lists the commits Restart Server would load and the commits the current build brought in, with when each landed.
- **macOS places in the folder picker** -- On a Mac, the folder picker offers Home, iCloud Drive, Desktop, Documents and Downloads.

### Changed

- **One attention list** -- Muted questions and tracked Notify Me tasks move into the top-bar attention list, replacing the separate needs-input and Notify Me menus. The sidebar's top row holds just search and Quests, and the amber attention chip counts only the open questions.
- **Takode messages as chips** -- Every message Takode injects into a conversation, including landing-queue notices, reminders and recovery notices, shows as one family of collapsed chips with a one-line summary instead of a full message bubble. The full text is a tap away, and the agent still receives it unchanged.
- **Reports in collapsed turns** -- A collapsed leader turn shows the reports it published as a clipped preview that expands in place.
- **Report comments** -- Comments on a published report go to the session showing it, like any other comment, and can be mixed with other comments, images and replies. They name the report's file instead of internal IDs.
- **Tab order follows your chats** -- Inside a status group, a tab also moves up when you write in it or the leader answers you there. Background activity does not move tabs.

### Fixed

- **Restart, PATH and shutdown regressions** -- The previous release accidentally shipped without three earlier fixes: Restart Server updating its checkout first (and its "Update the checkout before restarting" setting), sessions getting the machine's login-shell `PATH`, and the bounded wait that lets restarts always finish. All three are back.
- **Backends on the selected machine** -- The new-session dialog offers the backends the selected machine actually has, instead of checking the coordinator's machine.
- **Memory edits** -- `memory write` refuses to save over a note that changed since the session last read it, and asks the agent to read and merge first.
- **Jumping to a message** -- A message reached by a jump stays in place while images and cards load around it, including on iOS Safari.
- **File links with spaces** -- File links whose paths contain spaces, such as iCloud Drive's, render as links, and single tildes in prose stay literal.
- **Activity and turn durations** -- Activity group headers span from the first call's start to the last call's end instead of summing call times, and every turn summary shows its duration up to the agent's last activity.

## 2026-10-12

### Added

- **Thread tab status groups** -- Leader thread tabs show as one row of status groups on every screen size, replacing the tab strip: Main, then Needs you, In progress, New results and Done, each with its count, and Find to search every tab by title or quest number. A group of one opens its tab on a tap and a larger group opens its list; a long-press or right-click opens any group's list. Inside a group the tab that joined it most recently comes first, and the tab on screen glides into its new group when it moves.
- **Closing the tab on screen** -- The quest strip ends with a close button for the tab on screen. Closing slides it away and opens the next tab in the same group, or Main when the group is empty. A small spinner marks where the leader is writing.
- **Images in agent messages** -- Image paths render as file-name links that open the image viewer at that image, and the viewer shows the full path with a Copy button. `![caption](/path/to/image.png)` reserves its thumbnail from the first render and shows "Image missing" when the file cannot be fetched, including files on a remote host.
- **Swiping between images** -- A sideways swipe on an unzoomed image moves to the previous or next image in the viewer.
- **Markdown files inside Takode** -- Tapping a Markdown file link opens it in an in-app viewer, read on the linking session's machine, instead of an editor link that phones and remote files cannot open. Relative links inside it open further files.
- **Worker limit per leader backend** -- The number of workers a leader may run is a Settings value per leader backend, 8 for Claude leaders and 5 for Codex leaders by default.

### Changed

- **Quest view header on phones** -- The full quest view's header is compact on phones, with tags, commits and related quests in one wrapping row of chips that expand.
- **Quest status labels** -- The quest preview and the quest view show the same status (the active Journey phase, else Idea, Refined, In Progress, Done or Cancelled) and the same section names.
- **Inline quest links** -- The preview eye after a quest link sits in the text like a glyph, and is hidden on touch phones, where tapping the link already opens the preview.
- **Needs-input reminders** -- Needs-input reminders in the feed start collapsed as a readable one-line chip in both themes.
- **Next on the attention chip** -- The feed's attention chip reads "Next" instead of naming the item's kind.
- **Sidebar timer badge** -- A waiting leader's timer shows as a small clock on its portrait's corner instead of timer text.
- **Composer buttons** -- The collapse-all and minimize buttons are removed; the composer still collapses on a press outside it.
- **Commit attribution** -- Claude sessions no longer add "Co-Authored-By: Claude" or "Generated with Claude Code" lines to commits and pull requests.
- **Proposed improvement quests** -- Leaders propose quests for problems they notice themselves and wait for your approval before filing or dispatching them.

### Fixed

- **User Checkpoints ended by hand** -- Ending a checkpoint by hand keeps its questions open as non-blocking questions, and a planned checkpoint that a side question used up is put back. User Checkpoint dots use a real amber in the light theme.
- **Results read only when seen** -- A thread's results count as read only after it has been on screen for two seconds with the page visible, so a quest no longer moves to Done while its answer flashed by unseen.
- **Leader view after reconnect** -- After a reconnect or a move from Main to a quest thread, a leader's live view stays on the thread it shows.
- **Feed without late jumps** -- Notifications and thumbnails this browser already loaded appear with the conversation instead of pushing messages down a moment later.
- **Menus and popovers on touch** -- A second tap closes a menu or popover opened by a tap, including the session info panel, and popovers close as soon as a finger lands outside them.
- **Open Thread right after dispatch** -- Quest previews and views find a dispatched quest's leader before its worker claims it.
- **Quest complete card** -- The Quest complete card stays at the turn where the quest completed instead of moving to the latest turn.

## 2026-10-11

### Added

- **Your instructions and skills on every machine** -- Takode can keep your personal instructions (for all agents, Claude only or Codex only) and skills once on the coordinator and deliver them to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and the Claude and agent skill folders on every machine, so plain and Takode sessions read the same copy. Either store may link into a Git checkout. Setup and migration run as an agent task: Settings shows each machine's state and hands the job to a session you pick, which uses the new `takode user-content` commands. Files Takode did not write are replaced only with your approval, everything replaced is backed up, and Takode's own skills win a name clash. The [user instructions and skills guide](docs/user-instructions-and-skills.md) has the details.
- **Questions put quests in User Checkpoint** -- A leader's question in a quest's thread moves the quest into User Checkpoint on the work board until its last question is resolved, then back to Work with the same worker, so Work time excludes waiting on you. Leaders can mark a question non-blocking with `--no-checkpoint`, and dismissing a question tells the leader.
- **Quest previews on touch** -- Tapping a quest link in a message on a phone opens the quest preview sheet over the conversation, with an Open button for the full view; the back gesture closes it.
- **Open Worker and Open Thread** -- The quest preview and the full quest view start with buttons to the quest's worker session and its thread tab in the leader session, each showing its session number.
- **Linked to-dos** -- Personal to-dos can link related quests with `takode todo link`. Links never change a to-do's status, and the To-dos list shows each linked quest as a status chip that opens it.
- **`takode activity`** -- Lists the messages you typed in a time window and the final answers to them, as one narrative per session thread.
- **Transcribed tag** -- Dictated composer messages, needs-input answers and comments end with a `[transcribed]` tag you can delete, shown as a small mic marker, so agents know the text may hold transcription errors and ask when one matters.
- **More snooze choices** -- Remind me later offers 1, 6 and 24 hours, a custom amount and a day-and-time picker for snoozing until a chosen day.
- **Worker preview timer** -- The live worker preview in leader threads shows how long the worker's current turn has run.
- **Close tab and go to next** -- On a closable thread tab, long-press or right-click the feed chip's Next button to close the tab and go straight to the next item.

### Changed

- **Faster loading** -- Browsers keep the app's build files between visits, rarely used pages load on first use (the startup script shrinks from about 1,065 KB to 766 KB compressed), and the feed no longer redraws every message on other sessions' updates or on each new message. A tab left on an older build after a restart offers Reload when a page cannot load.
- **Quest preview** -- The quest preview's summary and latest progress are in full-size text, the worker and leader appear only on their buttons, and a cached preview opens at once and refreshes in place.
- **One-handed replies** -- Needs-input reply controls sit at the right edge with the send button last, within a right thumb's reach.
- **Paw marker** -- The newest answer in the feed keeps its paw and older answers rest as dots; when a new answer arrives live, the paw walks down to it.

### Fixed

- **New-session folders on the right machine** -- The new-session dialog checks a remembered folder on the selected machine, replaces one that is not there, and shows the full path with its machine. Recent folders list only folders that exist on the machine being browsed, and a remote session whose folder is missing on its host is refused before it is created.
- **Unread answers across tabs** -- Reading a leader answer in any quest tab that shows it marks it read there, and an answer shown in several tabs counts as unread only in its own thread.
- **Recording on a phone** -- Voice input keeps the screen awake while recording, so the phone's auto-lock no longer cuts off a long dictation, and the composer stays expanded when a transcription finishes.
- **Feed stays put on send** -- Visible turns no longer reload, and their images no longer flash, each time a new message arrives.
- **Terminal paste on touch** -- A long-press over the terminal on a touch screen offers Paste.
- **Multi-question answers** -- Answers to several needs-input questions are numbered once, and multi-line answers stay inside their item.
- **Quest previews without a summary** -- A quest without a TLDR shows the start of its description and closing note, and cancelled quests are labelled Cancelled instead of Completed.
- **Takode development skills** -- When Takode runs from its own repository, only the skills sessions need everywhere are linked into the global skill folders; the skills for developing Takode stay inside the repository.

## 2026-10-10

### Added

- **Drafts on every device** -- Unsent composer text, comments, report recipients, partly answered needs-input questions and uploaded composer images are kept by the server and appear in every browser, surviving reloads, including iOS reloading the Home Screen app. The last saved change wins, and a tab never loses its own unsent edit to another browser's change. Uploads still in progress stay in their tab.
- **Attention list** -- The top-bar attention control opens a list of everything that needs you across sessions, grouped by priority, with Go to on each row and a Next step with its own shortcut. Each chat's attention chip steps to that session's next item on tap and opens its list on long-press or right-click. Both keep their place as items are answered or added.
- **Peer leaders** -- `takode spawn --leader` lets a leader start another leader session in its own session space and memory space, optionally on another machine. The new leader is not herded under its creator, and a new session whose session space and memory space disagree is refused instead of being split.
- **Attention row details and actions** -- Rows name the thread tab and quest they belong to. Right-click or long-press a row for actions that fit it: mute, remind me later, acknowledge, mark as read, or close the thread tab, including another leader's closable tab.

### Changed

- **Board button** -- The work board button shows one phase-colored dot per active quest instead of a count, at a fixed size; the count and phase breakdown are in its tooltip.
- **Diffs from the quest banner** -- The top-bar Diff button is gone. The quest banner chip opens a quest's recorded commits and its worker's changes, labelled in plain text such as "2 commits · +120 -8", with a switch between commits and worker changes. Worker sessions show the same chip, and sessions without a quest get it while they have changes.
- **Machine chips** -- Machine chips use one neutral style and mark only hosts that cannot be reached, with an unplugged icon and a tooltip saying when the host was last seen.
- **Session cards** -- The archive button is removed from session cards. Archive from the card's long-press or right-click menu, or by swiping.
- **Worker preview header** -- The live worker preview in leader threads shows only a status dot, the worker number and Open session; a pulsing dot marks a working worker.
- **Terminal page** -- One compact row names the machine and folder, and a machine menu moves the terminal to any connected machine.

### Fixed

- **Unread results from quest tabs** -- Going to Main's unread result from a quest tab opens Main at its newest Ready result instead of returning to the quest tab.
- **Ready turns stay collapsed** -- A leader turn collapses again on each new Ready result, even after it was opened from a notification or expanded earlier in the quest.
- **Go to bottom** -- Jumping to the bottom from an older part of a conversation no longer restores an older saved reading position.
- **Resuming after restarts** -- After Takode interrupts a turn to restart or update itself, the resumed session is told that Takode, not the user, cut off the tool call and that the call may have partly run.
- **Session PATH** -- Sessions get the machine's real login-shell `PATH` instead of a guessed list of directories.
- **Landing gate errors** -- The landing queue checks unhandled test errors against the base commit like failing tests, so an existing leak no longer bounces unrelated changes while a new reproducible one still blocks.

## 2026-10-09

### Added

- **Landing queue** -- A shared branch can opt into a landing queue by saving a gate for it with `takode land gate`. Workers check their change with `takode land test` and hand it off with `takode land submit`. The server then stacks waiting changes on the branch tip, runs the gate once for the batch and pushes it. A change that conflicts or brings new failures bounces to its owner, while failures that also occur on the base commit do not block. Workers are free once they submit, and the quest completes when its change lands.
- **Server time zone** -- Settings has a server time zone, applied at every server start, for chat timestamps, herd events and timers on a server whose machine runs in another zone.
- **Host updates after Restart Server** -- After Restart Server, auto-updating hosts move to the new build right away instead of waiting until they are idle. Interrupted turns continue once their host is back, and Settings shows each host's progress.
- **Quests led by another leader** -- A quest tab handed to another leader is muted and marked "Led by #N", and the quest header links to that leader. Quests on no board read "Not on board".
- **Board button** -- Leaders open their work board from a Board button in the top bar on any thread and at every width. The board opens in place with its own Active / Completed switch and is easier to read, especially in the light theme.
- **Session attention chip** -- Each chat's lower-right chip counts that session's questions, Notify Me results and unread results and opens them one at a time.
- **Coordinator move guide** -- A guide covers moving the coordinator to another machine: what moves, rehearsal on a copy, cutover, verification and rollback. The remote hosts guide lists the Git version hosts need and how immediate host updates work.

### Changed

- **Restart Server follows its branch** -- Before restarting, a production server fetches the branch its checkout tracks, fast-forwards and reinstalls dependencies. When the checkout cannot simply follow, for example because of local changes, the restart stops before interrupting anything and says why. Settings shows the commit the server runs, warns when a restart would load older code, and can turn the update off. Restart Server asks for confirmation in the page and shows its progress.
- **Faster switching over slow connections** -- Switching sessions and thread tabs over a remote connection sends far fewer bytes and round trips. The browser keeps one connection across switches, large messages are compressed, including for Safari and iPhone, unchanged session-list polls return nothing, and opaque thinking signatures are no longer sent to browsers.
- **Faster host connections** -- Traffic between hosts and the coordinator, and agent command answers on hosts, are compressed.
- **Remote agents use the coordinator's data** -- Agent commands on a host never fall back to that machine's own Takode files, and the stream command also runs through the coordinator.
- **Agent waiting** -- Agents end their turn instead of chaining sleeps: Claude sessions wait for a background command's completion notice, and Codex sessions use a timer. The work board does not report such workers as stalled.
- **Running activity time** -- An activity card's heading counts the total time of running tools live.
- **Lease wait time** -- The lease chip shows how long a session waited for its lease.
- **Quest header on phones** -- The quest header chip drops its phase total on phones, and finished quests read "Done".
- **Permission rules** -- Takode no longer re-applies Claude Code `settings.json` allow rules itself; Claude Code applies its own rules. Requests go through hard denies, the permission mode, then you.

### Fixed

- **Phone session lists** -- Compressed API answers are sent whole, so session lists no longer show empty through proxies that speak HTTP/1.0.
- **Restarts always finish** -- Server shutdown waits at most 30 seconds for accepted work, logs what it waited on, and no longer hangs on a host that cannot reconnect.
- **Hosts stuck mid-update** -- A host whose update fails is reported and released, and creating a session on an offline or updating host fails at once with its name instead of hanging.
- **Claude login in launched sessions** -- A server or node started from inside a Claude Code session no longer passes that session's login to the agents it launches, which made them report "Not logged in".
- **Host CLI tokens** -- `takode host` and server management commands work from sessions on a remote host.
- **Turn errors** -- A failed turn's error stays in its own turn and thread instead of following later turns in Main.
- **Installs through registry proxies** -- The Claude Agent SDK is pinned to a version that npm registry proxies already serve, so frozen installs no longer fail with 404s.

## 2026-10-08

### Added

- **Moving the coordinator** -- A coordinator handoff tool moves a whole coordinator to a machine that already runs its sessions as a host, with checksums for every file. The old machine becomes a host, a rehearsal mode packages a copy without stopping anything, and the old machine is fenced off until it is explicitly reclaimed for a rollback.
- **Next and a cleaner top bar** -- A Next button opens the next item that needs you. The session top bar keeps only the sidebar toggle, the session title, Next and Diffs; the sessions panel opens with a search field for Universal Search and chips for needs input, Notify Me and Quests on desktop and phone. Universal Search can show leaders only and include archived sessions.
- **Waiting workers** -- Idle workers that wait on a background job, a lease or a landing run show what they wait for in the sidebar, the work board and the top bar instead of a plain idle dot, and the board no longer reports workers queued for a lease as stalled.
- **Host port** -- The coordinator also listens on a token-only host port (main port + 1000) for hosts and their agents, so a tunnel on a shared machine does not open the server to other users there. The remote hosts guide covers forward tunnels and loopback-only coordinators.
- **Machines on memory notes** -- Memory notes record which machines wrote them, and the memory catalog and Memory page show it.

### Changed

- **Claude Agent SDK 0.3** -- Claude sessions run on the Claude Code bundled with Agent SDK 0.3, which reads `AGENTS.md`.
- **Sessions survive restarts by default** -- The server always runs this machine's sessions under its own node, so they keep running across restarts. A deliberate server stop still stops them.
- **Focused pre-submit checks** -- `takode land test` runs typecheck and format in full but only the tests chosen for the change, with `--full` for the whole gate. Stopping a run frees its test slot at once.
- **Workers' questions stay with their leader** -- Questions from herded workers stay out of the global needs-input count, title count and Next, and stay answerable by their leader until answered.
- **Lease exit codes** -- `takode lease acquire` exits non-zero when it only joins the queue.

### Fixed

- **Comment drafts** -- Clicking outside the comment editor saves a non-empty comment instead of discarding it.
- **Comment-only requests** -- Answer labels preview requests sent only as comments.
- **Memory locks** -- A memory lock held by a session that has exited is taken over, and only the lock's holder can write.
- **Delivery checks on hosts** -- Commit evidence for quests is checked on the machine that holds the checkout.

## 2026-10-07

### Added

- **Sessions on other machines** -- Register a machine with `takode host add` and run `takode node` on it to run Claude Code and Codex sessions there, while the coordinator keeps sessions, quests, boards and memory. Git status, diffs, file previews, worktrees and terminals run on the session's machine, and agents there use quests, memory and Takode commands unchanged.
- **Workers on any machine** -- `takode spawn --host` starts a worker on a registered machine, and workers start on their leader's machine by default. A worker on another machine than its port target hands its commits back as a Git bundle. Each host has its own pool of machine-local leases, while port leases for a branch are shared across machines.
- **Machines in the UI** -- Settings → Hosts registers and removes machines, names them, and sets which Claude Code and Codex each one runs. The new-session dialog picks a machine and browses its folders and branches. Remote sessions show their machine across the sidebar, top bar, hover cards and board, and `takode list` marks them.
- **Sessions survive server restarts** -- Sessions on hosts keep running while the coordinator restarts, and a setting does the same for this machine's sessions. The restarted server reattaches to them with their pending permission requests.
- **Host auto-update** -- Hosts report their Takode build, and a node started with `--auto-update` follows the coordinator's commit when its sessions are idle.
- **Machine names on quest notes** -- Every machine keeps a stable name, sessions are told which machine they run on, and quest notes are stamped with the machine they were written on.
- **Network outage recovery** -- When a Claude turn cannot reach the model API, it waits for the connection instead of failing and continues on its own once the network is back, with at most five automatic continues per outage.
- **Browser login** -- An optional password can guard the app's API, live connections and file previews. Agents and hosts keep using their tokens.
- **Remind me later** -- Needs-input questions can be snoozed until a chosen time and come back as fresh alerts.
- **Leader-to-leader messages** -- `takode send` can message another leader session directly.
- **Delivery status for sent messages** -- `takode send` and `takode answer` report whether a message was delivered, failed or is still queued, and the sender is told when a queued message is finally delivered.
- **Quest cards in leader threads** -- Quest threads open with a card describing the quest, also when the thread has no messages yet, and completed quests end with a card showing the final summary.
- **Long-press menus** -- Thread tabs, session rows, file links, the session title and Session Space headers share one native-style long-press menu on touch screens, and thread tabs get a menu with Close tab and Notify Me.
- **Image zoom** -- Image previews zoom with pinch, drag, mouse wheel and double-tap.
- **Notification links** -- Agents can link to a needs-input question; the link previews it on hover and jumps to its card.
- **Collapsible quizzes** -- Quest quizzes in the chat can be collapsed.
- **Command latency log** -- `takode latency` summarizes how long Takode commands and Codex requests take and where the time goes.

### Changed

- **Settings groups** -- Settings is reorganized into clearer groups, with switches, a visible theme picker and steppers.
- **LLM auto-approval removed** -- Takode's model-based permission approver is retired now that Claude Code and Codex have their own auto-approval modes. Saved rules stay on disk untouched.
- **Quest and memory writes go through the server** -- Quest and memory commands no longer write files directly, so a command on another machine cannot create a diverging copy.
- **Faster quest commands** -- Quest reads are served from memory, so quest commands and the board answer much faster.
- **Shorter source tags** -- Messages from leaders and agents are tagged only with session numbers.
- **Rejected leader messages** -- A leader message rejected for a bad thread tag collapses into a compact row that expands to the original.
- **Session cards** -- The permission shield icon is removed from session cards; the permission mode stays in the composer.
- **README** -- The README now leads with leader-driven session management, presents sessions on several machines and has refreshed screenshots.

### Fixed

- **Claude status chip** -- The generation chip stays visible while Claude waits on the model, and its timer no longer restarts mid-turn.
- **Microphone choice** -- Dictation records from the microphone the system has selected and shows its name, and iPhones no longer repeat or silently deny microphone prompts.
- **Faster startup** -- Large chunked session histories load about ten times faster at startup.
- **Claude processes end with their session** -- Killing or archiving a Claude session ends its process.
- **Stale tool progress** -- Opening a running session no longer shows finished tools as still running.
- **Leader answers for mid-turn input** -- A Claude leader's answer to a message sent mid-turn is accepted, and network errors no longer trigger routing reminders.
- **Removed project skills** -- Skills removed from the repository are uninstalled at startup instead of leaving dangling links.

## 2026-10-06

### Added

- **Send key setting** -- Comment, quest feedback, Side Chat and answer boxes use the composer's send key, and a new setting makes Enter add a newline and Cmd+Enter (Ctrl+Enter) send.
- **Screenshots in decisions** -- Local image paths render as file links, and visual decisions show their screenshots inline.

### Changed

- **Needs-input explanations in the conversation** -- The explanation for a needs-input question is written into the thread as an ordinary message, and the card, phone alerts and attention panels show only the question.
- **Activity cards** -- Activity cards collapse to their heading once later text follows them, and their lines show skill names, shortened file paths and MCP server and tool names.
- **Thread links** -- A message from another thread shows a clickable link to the one thread it was written in.
- **Collapsed turns** -- A collapsed leader turn without an answer shows its last message.
- **Memory page** -- Memory folders start collapsed, like a table of contents.
- **Memory reading** -- Agents read memory through the catalog and folders; the weighted memory recall command and the Codex `memory_recall` tool are retired.

### Fixed

- **Activity grouping** -- Thinking stays inside activity cards, and cards no longer add an empty Needs input chip below a question.

## 2026-10-05

### Added

- **Web Push phone alerts** -- Phone alerts can go through Web Push alongside Pushover, with the same delay and filters. Devices enroll from Settings (on iPhone from the Home Screen app), and alerts skip a device that has Takode on screen.
- **Claude Auto mode** -- Claude sessions offer Claude's own Auto permission mode, and permission mode changes apply to the running Claude process.
- **Claude reasoning effort** -- Claude sessions get the Model and Effort menu, taken from Claude Code's model catalog and applied without a relaunch.
- **Live worker preview** -- A leader quest thread waiting on its worker shows the worker's latest actions in the conversation, with an edge colored by the worker's status.
- **Copilot setup guide** -- A guide and setup script run Takode's Claude sessions on Claude models served by a GitHub Copilot subscription.

### Changed

- **Claude runs through the Agent SDK only** -- Claude Code's current versions reject the native WebSocket backend, so Claude sessions run only through the Agent SDK. Saved Claude sessions resume through it, and Claude sessions in containers are refused.
- **Compact activity cards** -- All agent activity between two pieces of text forms one card with a summary heading of failures, counts and total time over its newest lines. A single tool shows as one light line with its description, and Claude commands group like Codex commands.
- **Complete messages** -- Assistant text appears once each message is complete instead of streaming into the browser.
- **Needs-input cards** -- Question cards show their decision context, use a neutral style with full-width option rows, and their text can be commented on or copied.
- **Lease waits** -- Sessions queued for a resource lease show as waiting, naming the pool, instead of idle.
- **Memory folders** -- Memory notes live in topic folders, and the catalog shows recent notes plus one line per folder so it stays small. The Memory page groups notes by folder.
- **Quests start in Work** -- Quest Journeys start in Work, and workers send optional reports instead of waiting for an initial approval.
- **Large session histories** -- Large histories are saved incrementally instead of rewriting a full snapshot on every save, with bounded memory use and saves committed in order.
- **Claude model list** -- The Claude model menu lists the models Claude Code itself reports, including the running model.

### Fixed

- **Claude turn control** -- Interrupts end turns Claude never received, queued input reaches resumed sessions, and a Claude process that ends unexpectedly is reported instead of stalling the server.
- **Claude status readouts** -- Live context usage uses the window Claude reports, long-running tools keep one progress entry, the turn timer keeps its start when a session is opened, and a session created with a permission mode keeps it.
- **Claude leader routing** -- Thread markers in Claude leader messages that follow a thinking block are routed.
- **Composer buttons** -- The microphone and send buttons stay in place while a reply streams, with Stop at the far left.
- **Thread handoffs** -- Requests handed to a quest thread stay there after a server restart.
- **Restart Server checks** -- Restart Server checks that the backend loads with installed dependencies before shutting down.
- **Shutdown keeps pending work** -- Server shutdown stops taking new work and finishes work it already accepted before exiting.
- **Build time** -- The sidebar build time uses the browser's time zone.
- **Dependency security updates** -- hono, sharp and shell-quote are updated for security advisories.

## 2026-10-03

### Added

- **Markdown reports** -- `takode report` publishes a Markdown file as a fixed snapshot in the chat. Passages can be commented on and the comments sent to the session or its worker, with drafts kept across reloads.

## 2026-10-02

### Fixed

- **Quest detail editing** -- Quest details loaded on demand stay editable.

## 2026-09-30

### Fixed

- **Node REPL previews** -- Node REPL tool calls show their titles in activity previews.

## 2026-09-29

### Added

- **Session menu from the title** -- Clicking the session title in the top bar opens the same session menu as the sidebar.

### Fixed

- **Quest completion evidence** -- Completing a quest whose Journey repeated phases checks only the current run's evidence.

## 2026-09-28

### Changed

- **Codex built-in memory off** -- Codex sessions launched by Takode turn off Codex's own memory, so background consolidation cannot act with orchestration authority. Takode memory is unchanged.

### Fixed

- **Voice transcription retries** -- Failed transcriptions keep their context, and recordings flagged with a warning can be retried.

## 2026-09-24

### Changed

- **Quest commit ranges** -- Commit chips can browse a verified range of commits behind a recorded delivery, and deliveries published to a separate branch record their complete approved commit set.

## 2026-09-23

### Added

- **Counted resource leases** -- Leaders can configure resource pools with numbered slots, one reservation per session and FIFO waiting. Renewal, expiry and recovery target individual slots; existing singleton reservations migrate without losing ownership or queue state.
- **Leader lease recovery** -- Leaders can release stale or abandoned reservations held by other sessions without waiting for expiry. Recovery releases one selected slot and leaves the underlying processes and data untouched.
- **CLI text inputs** -- Session messages and worker answers accept stdin; proposal summaries, phase notes, timer descriptions, skill content, cron prompts, and delivery-target JSON accept file/stdin input. Help and agent examples show quoted heredocs and separate summaries without routine temporary files.

### Fixed

- **Skill content parsing** -- Ambiguous inline content beginning with option syntax is rejected with file/stdin guidance instead of sending a boolean as Markdown.
- **Expanded composer clearance** -- Desktop conversations can be scrolled above the expanded composer to reveal covered passages. Expanding or collapsing keeps the feed stationary, and used scroll space remains available until switching destinations.

## 2026-09-20

### Changed

- **Agreed design replacements** -- Agent guidance carries an approved replacement through planning and implementation, retiring superseded behavior within scope while preserving required compatibility, shared functionality and user data.

## 2026-09-19

### Changed

- **Leader recommendations** -- Guidance anchors recommendations in accepted decisions and favors the smallest coherent change. Proposals that revisit an agreed tradeoff must explain the departure and preserve approval requirements.

### Fixed

- **Post-compaction memory catalogs** -- Codex attaches fresh memory orientation to the next ordinary input after compaction, without an extra model turn or duplicate required guidance. Catalog failures leave ordinary work usable, and repeated boundaries do not duplicate the attachment.
- **Disposable worker branches** -- Archive cleanup again removes proven Takode-created, exclusively owned worker branch names after preserving their committed tips for recovery. Original worker checkouts retain force-removal; shared, retained, user-owned and unproven branches stay protected, with auxiliary and retry safeguards unchanged.

## 2026-09-18

### Added

- **Auxiliary worktree retention** -- Workers can register extra checkouts as temporary or retained. Archive cleanup protects shared and retained checkouts, checks temporary work before removal, and preserves Git branches independently of checkout environments.

### Changed

- **Mobile quest banners** -- The title and right-aligned Journey pill share one row. Expanded details show the current worker, while a manual collapse control saves screen space without reopening on phase updates.
- **Quick quest search** -- Reuses prepared search documents and cancels superseded requests to reduce repeated work while preserving current results and relationship-aware freshness.
- **Notify Me phone alerts** -- Settings provides a separate, default-on Pushover filter for monitored results, independent of ordinary review notifications.
- **Blocker escalation** -- Agent guidance now asks agents to check available context, resources and alternative approaches before asking the user to resolve an avoidable blocker.

### Fixed

- **Memory catalog freshness** -- Catalog diffs detect note-body edits, descriptions have a 1,000-character validation limit, and agent guidance reuses preloaded catalogs while preserving direct note checks. Clipped preloads no longer mark unseen content as observed.
- **Search activity** -- Pending quick searches show an animated status indicator, with reduced-motion support, until results arrive.
- **Recent attachment counts** -- Recent message previews show separate image and comment counts, including messages with attachments but no text.
- **Input delivery order** -- Human and leader input carries earlier queued observations in chronological order without pulling later background events into an active turn. Input already sent to that turn is not resent by a stale queued turn.
- **Codex recovery guidance** -- Required recovery instructions and leader skills survive compaction without duplicate recovery messages. Leader recycle also retains its skills when the optional memory catalog is unavailable.
- **Codex recovery stability** -- Quiet compaction is no longer treated as a stuck turn. Repeated automatic recovery requests share the current relaunch instead of restarting its replacement.
- **Compaction status** -- Conversation markers distinguish compaction starting from completion, so an in-progress compaction is not presented as finished.
- **Pending message visibility** -- Queued input remains visible in its valid destination thread even when another routing field is blank or invalid. Inputs without a known destination retain global visibility.
- **Active Codex timers** -- Verified timer firings can reach an active turn with earlier queued observations, while paused or interrupted work stays protected.

## 2026-09-17

### Changed

- **Leader sidebar cards** -- Leader cards omit numeric Git divergence and line-change counts. Git details remain available on hover, and worker cards keep their existing counts.

## 2026-09-14

### Changed

- **Smaller frontend transfers** -- Production JavaScript and CSS can be served as build-time gzip copies, preserving the decoded application and existing cache/build behavior.
- **Quest status and participant chips** -- Leader headers use the same colored Journey pill and progress count as worker headers. Worker-side Leader links match the lighter Worker-link style while retaining role, identity and navigation. The single-action Notify/Acknowledge control is unchanged.

### Fixed

- **Composer focus** -- Temporary focus loss during internal controls or voice input preserves expansion. Outside clicks, keyboard focus moving outside, navigation, sending, and manual minimization keep their existing behavior.
- **Resolved Needs Input cards** -- Completed decisions remain inspectable in the conversation, including their full questions and exact recorded replies in chronological order. Missing replies are identified without substituting unrelated messages.

## 2026-09-13

### Added

- **Automatic startup asset timings** -- Home Screen startup diagnostics can retain a bounded entry JavaScript/CSS timing summary, with explicit missing-data limits and no manual inspection or content capture.
- **Mobile load diagnostics** -- Bounded startup, foreground, and selected-feed timings are retained in server logs alongside the actual browser connection, with explicit limits on what browser callbacks establish.
- **Notify Me phone alerts** -- New monitored results can send dedicated Pushover alerts using the existing review filter and delay, with direct links to their task tabs. Acknowledging, replying to, or untracking a result before delivery suppresses its pending push.

### Changed

- **Compact diff viewer** -- Commit modals fill the viewport with two compact context rows, visible change totals, a file picker, and on-demand comparison details. Commit and review navigation remain accessible while code keeps the full width.
- **Quest headers** -- Phase names use quiet inline text without counts, duplicate waiting notices are removed, and Worker and Commits remain directly accessible. Pending results replace Notify with Acknowledge; acknowledging restores Notify while tracking stays enabled. The Notify tooltip retains the full Notify Me name.
- **Compact draft indicators** -- The first-line preview indicates additional lines and shows image and comment counts while preserving the complete draft and attachments.

### Fixed

- **Comment highlights** -- Passage shading stays uniform across formatted text and overlapping comments. Attached comments keep a dim highlight that strengthens on hover or while editing, and chip navigation brings the selected passage near the top of the feed.
- **Voice composer expansion** -- Starting voice input deliberately expands the composer and keeps the transcription visible until a later interaction minimizes it.

## 2026-09-12

### Changed

- **Compact composer** -- Desktop and mobile start with an input showing the draft's first line. Expand to edit; sending or leaving the composer minimizes it. Drafts and attachments survive, and the minimize button fits in the existing toolbar.
- **Interrupted-work inspection** -- Recovery guidance continues from available context and uses bounded history pages only for missing details. Codex close diagnostics retain termination details and evidence references without enabling raw protocol recording or claiming an unproven cause.

### Fixed

- **Delivery comparisons** -- Commit chips identify their comparison baseline, and merge statistics and opened patches use the same first-parent view. Earlier saved totals stay inspectable, while reporting distinguishes pending and newly delivered batches without repeating historical commits.
- **Comment source navigation** -- Attached comments can locate their original message beyond the loaded history window without jumping to a different passage or a child-only conversation.
- **Overflow task tabs** -- The More menu keeps click and keyboard navigation without hover previews covering its rows; previews remain available on visible tabs.

## 2026-09-11

### Added

- **Notify Me** -- Monitor named task tabs and keep new results in a global list until acknowledged or replied to; monitoring survives viewing, tab closure, and reconnects while ordinary unread and needs-input remain independent
- **Conversation comments** -- Attach comments to selected passages, inspect their quoted context and source highlights, and send them alongside text or images. Voice editing can update the attached comments.
- **Browser connection diagnostics** -- Server logs record transfer bytes, backpressure and synchronization timing for each browser connection without retaining message payloads.

### Changed

- **Composer controls** -- Manual minimize and expand controls preserve the complete draft, images and comments while hiding their content. Comment previews and selection controls make attached passages easier to inspect and edit.
- **Citation guidance** -- Session instructions prefer supported clickable source links while preserving required citation formats and the exact content of quoted or stored messages.

### Fixed

- **Leader session return** -- Restoring the previously selected task tab no longer moves it ahead of the server's saved tab order.

## 2026-09-10

### Added

- **Independent delivery targets** -- Leaders can record an explicitly approved publication's exact repository and branch heads without moving it onto an unrelated integration branch. Commit inspection reads from the recorded delivery target.

### Changed

- **Journey approval cards** -- Proposals render their complete Markdown summary and native links in one readable card, with shell details available through separate raw inspection.
- **Thread continuation notices** -- Ordinary conversation notices disappear when agent activity returns to the viewed thread, while original history and navigation remain available. Loading older history does not resurrect an expired notice.

### Fixed

- **Long turn durations** -- Turn summaries display hours and minutes for long runs instead of an unwieldy total number of seconds.

## 2026-09-09

### Added

- **Tracked commit deliveries** -- Commit links stay tied to an exact recorded delivery batch, with retained review history and receipts for partial ports. Port guidance requires fast-forward updates to shared integration branches and preserves already-landed history.

### Changed

- **Turn activity disclosure** -- One top control expands or collapses a turn's activity. Shared indentation and a continuous guide keep tools, commentary and system events aligned while preserving the full audit details.
- **Compact commit chips** -- Adjacent commit links form aligned compact rows while retaining full titles, change totals and access to the exact selected commit.

### Fixed

- **Request handoff history** -- Moving unfinished work from Main to a task tab preserves the original request and related answers in their original thread while responsibility stays with the new owner.

## 2026-09-08

### Added

- **Main-to-task handoff** -- Leaders can explicitly transfer unfinished requests and selected decisions from Main to a task tab without treating that transfer as an answer or completion.
- **Scheduled thread reports** -- Leader timers retain the destination selected at creation. Each firing can receive its own answer, including after queued delivery or restart, without settling unrelated user requests.
- **Codex retry progress** -- The activity indicator shows confirmed internal response retries and returns to normal when output resumes, without inventing retry counts.

### Changed

- **Leader context commands** -- `/compact` requests Codex compaction and `/recycle` requests a one-time leader recycle. Neither changes the configured automatic context policy.
- **Compact Journey status** -- Board and header summaries show one current state or phase with its position, keeping the full Journey available in detail views.
- **Continuation links** -- Notices label the viewed source or destination as the current thread while keeping the other thread's name and navigation.

### Fixed

- **Conversation navigation** -- Turn expansion, scaled scroll positions and bottom navigation remain stable as history windows change. Sending keeps the feed following new output without moving readers who are inspecting older messages.
- **Decision chronology and quizzes** -- Full decision context and replies stay in chronological order, and each quiz uses one visible presentation instead of appearing twice in collapsed activity.
- **MCP status errors** -- Server-status retrieval failures appear in Session Info instead of failing the session or adding conversation errors. Successful retrieval clears the diagnostic while independent server startup failures remain visible.
- **Interrupted Codex delivery** -- Terminal recovery records no longer block later requests, and a delayed continuation cannot deliver after its recovery ownership has ended.
- **Completed stream replay** -- Completed Codex output no longer reappears as a second live footer after conversation synchronization; genuine unfinished output and child-session ownership remain intact.
- **Needs Input attention** -- Unresolved prompts remain distinct from unread results in session and group indicators instead of being counted as both.

## 2026-09-07

### Added

- **Captured instruction viewing** -- Codex instruction sources are grouped under Developer Instructions with explicit viewing of captured content. Unavailable or unverified captures stay identified rather than being replaced with current file contents.
- **Native computer-use defaults** -- Supported macOS Codex sessions can use the configured native computer-use runtime at normal startup while preserving custom settings. Each app and its intended use still require explicit human approval; Claude sessions remain excluded.
- **Delivery evidence correction** -- Assigned workers can correct invalid recorded commit evidence through an audited operation that verifies the expected prior list and selected target, without advancing the Journey.

### Changed

- **Suggested replies** -- Agent guidance requires convenient reply shortcuts alongside complete decision context, while custom responses remain available and shortcuts never count as approval by themselves.
- **Shared leader answers** -- One answer can appear across the related Main and task tabs without duplicating its text or settling unrelated requests. Bounded thread views retain the relevant complete answer set.

### Fixed

- **Answer retention** -- Routine outcome bookkeeping stays commentary so it cannot replace the substantive answer as the current result.

## 2026-08-31

### Changed

- **Session identity projection** -- Compact navigation rows take session names, claimed-quest fields, and live-only rename animation from one synchronized authority while detail, mutation, and recovery state remain separate

### Fixed

- **Build mismatch actions** -- Takode distinguishes the browser-loaded frontend, server-served frontend, and backend build; Reload is offered only for a coherent server pair, while broken or identity-less pairs request a full restart and stale probes cannot restore the wrong banner

## 2026-08-30

### Added

- **Build compatibility enforcement** -- Takode detects incompatible frontend/backend builds, shows an explicit recovery notice instead of silently keeping mixed versions, and prepares and validates replacement frontends before interrupting the current compatible pair

### Changed

- **Codex compaction accounting** -- Ordinary usage uses the provider's last total while prompt input, configured capacity, and compaction cause stay distinct; uncorrelated automatic compactions remain cause-unknown instead of receiving synthetic charged-context claims
- **Scheduled quest tabs** -- In-motion work stays ahead of queued or proposed tabs, scheduled tabs can be dismissed without changing board state, and genuine activation can resurface them safely
- **Session navigation authority** -- Compatible builds use one canonical server row across navigation surfaces, so stale REST state cannot make active sessions appear idle while first-upgrade migration and raw actions remain safe
- **Leader thread authority** -- Current-build leader tabs use one synchronized visual authority with preserved phase colors, ordering, routing, current-run fencing, and bounded persisted-tab migration
- **Browser conversation synchronization** -- Current-build browsers use one bounded server-authored history and thread path; routine full-history and unused sidecar delivery are removed while explicit recovery, routing, attachments, and replay remain intact
- **Session attention authority** -- Compact unread, needs-input, and timer visuals use one fail-closed synchronized projection across browsers while notification detail, permissions, persisted read state, and mutation remain authoritative separately

### Fixed

- **Interrupted leader continuation** -- Interrupted Codex leader work stays visibly recoverable in its thread; one safe continuation can finish missing work without replaying completed actions, and generic errors disappear only after recovery actually queues
- **Prolonged Codex outages** -- Eligible exact pending work continues low-frequency recovery beyond finite reconnect cycles without duplicate execution, persistent retry noise, or unbounded storage

## 2026-08-29

### Added

- **Inline quest feed previews** -- Chat-feed quest links remain direct while compact validated status and same-color eyes open canonical full previews with accessible keyboard and touch behavior plus fail-closed thread routing

### Changed

- **Synchronized session attention** -- Session rows, aggregates, search and cron results, reviewer badges, and hover cards begin sharing one server-authored attention value while detailed notifications and actions remain authoritative
- **Codex collapsed response phases** -- Official nullable Codex phases select collapsed final responses, commentary stays expanded-only, and genuinely unannotated history keeps a conservative fallback without exposing hidden routing or reasoning fields
- **Session navigation projections** -- Lists, groups, hover cards, links, and selected-session surfaces begin sharing bounded server-authored navigation state while established backend actions remain authoritative
- **Leader thread projections** -- Quest tabs begin using synchronized Journey and participant state with semantic phase colors while preserving existing navigation, attention, and first-upgrade migration behavior

### Fixed

- **Sidebar unread propagation** -- Unselected rows, hover cards, and Session Space totals share one server-authored unread summary, so fresh Ready counts reach other browsers before selection while stale or closed attention stays suppressed

## 2026-08-28

### Added

- **Natural explanation guidance** -- Bundled cross-agent guidance favors natural, audience-aware, fresh-reader, concept-first explanations while leaving format and workflow choices to agent judgment and narrower rules
- **Pending attachment slots** -- Explicit message images reserve ordered accessible loading tiles and become previews in place; terminal failures disappear while speculative paths remain silent

### Changed

- **Intent-first quest creation** -- Leaders preserve requested outcomes, confirmed or mandatory constraints, and hard-to-recover evidence without turning unconfirmed ideas or technical plans into binding scope
- **Codex subagent workspace** -- Native child inspection uses the full chat workspace with compact responsive navigation, oldest-to-newest paging, dismissible warnings, and no empty controls for sessions without genuine children
- **Accepted Work handoff** -- Accepted Work and its synchronized commit or explicit no-code evidence appear before mandatory Memory, while stale or missing evidence is blocked
- **Recent and Messages search** -- Universal Search's query-free Recent view shows one latest human message per destination, while scoped Messages preserves every matching message with canonical routing and evidence-backed status
- **Completed waiting tabs** -- Completed quest tabs stay visually active while their authoritative state is Thread Waiting and return to muted when the wait clears or becomes Ready

### Fixed

- **Codex turn settlement** -- Delivered stale owners drain before queued work and reconnect snapshots missing locally observed tools become actionable no-replay interruptions instead of stuck or repeated output
- **Message route restoration** -- Deliberate manual scrolling retires superseded message-route and pending-target ownership so Browser Back no longer snaps to an obsolete search target while fresh links and automatic restoration remain intact
- **Production frontend snapshots** -- Production serves validated app-owned frontend copies and uses application readiness separately from backend liveness, preserving the last good UI when replacement builds or cleanup fail
- **Quest feedback links** -- Canonical feedback links keep stable zero-based targets through reload, browser history, collapsed Journey history, and deletion tombstones
- **Native child feed isolation** -- Ordinary root chat, navigation, searches, reasoning groups, and lifecycle state exclude proven Codex child activity while canonical child audit history remains inspectable

## 2026-08-27

### Added

- **Native Codex subagent inspector** -- A server-owned registry and read-only responsive inspector show genuine child reasoning, messages, tools, results, and errors chronologically with bounded privacy-safe history and fail-closed partial or legacy coverage
- **Shared Markdown math** -- Safe accessible KaTeX rendering for dollar and stored backslash delimiters preserves exact source, copy, selection, malformed fallback, streaming, tables, and local overflow
- **HTML file browser tabs** -- Resolved HTML file links open in native new tabs with scripts and supported relative assets through capability-scoped serving without granting Takode API, session, or generic filesystem authority

### Changed

- **Quest CLI plugin workflow** -- The Codex plugin makes the existing Quest CLI the sole public Quest interface, routes mutations through live Takode authority, preserves managed sessions, and retains focused Todo, Memory, and Lease MCP tools
- **Expanded quest reconciliation** -- Same-quest design-to-build continuations require immediate title, description, and TLDR reconciliation before implementation resumes, with delivery claims gated by synchronized evidence

### Fixed

- **Leader reconnect viewport** -- Lifecycle snapshots and stale-anchor migration preserve the real selected message and offset across reconnects, reloads, and delayed hydration without weakening fresh navigation
- **Queued Codex inputs** -- Text and image messages steer or safely restart at the earliest supported point, with one owner-scoped pending state and safe Retry, Edit, and Cancel actions that prevent replay and starvation

## 2026-08-26

### Added

- **Takode Codex plugin** -- An opt-in plugin packages Takode integration for ordinary Codex tasks while managed Takode sessions retain their existing identity and lifecycle

### Changed

- **Design-to-delivery continuity** -- One intended design-and-build outcome stays in one quest through explicit checkpoint routing, preserves worker-owned closure, and requires delivery evidence before testability claims

### Fixed

- **Passive leader returns** -- Re-entering a leader session preserves the actual selected thread and stable viewport instead of letting stale layout continuity or late hydration switch the user elsewhere
- **Stale Codex recovery owners** -- Automatic-input recovery shows exact-owner testing or active state, retires provider-proven completed owners, preserves held inputs exactly once, and stops stale work from replaying across reconnect or watchdog cycles

## 2026-08-24

### Added

- **Recent asks** -- Universal Search adds a bounded global view of exact human-request bundles with canonical quest links, stable message jumps, compact expandable text, and evidence-backed response status without rendering response bodies

### Changed

- **Voice rerun offers** -- Append-to-edit and edit-to-append reruns share one compact status, action, and dismiss row while preserving the result and same-audio in-memory rerun behavior
- **Evidence-based safety scope** -- Leader and worker guidance preserves access safeguards, requires explicit direction, policy, an approved contract, or payload evidence before fidelity-changing transformations, and requires existing authority or a User Checkpoint for material scope, cost, validation, or acceptance expansion

### Fixed

- **Attached-message chronology** -- Older requests and reasoning attached to a live quest thread retain their canonical position above newer completion, quiz, and Ready content, matching refresh without duplicate tails or viewport jumps
- **Retained quest titles** -- Completed, cancelled, or board-removed leader tabs keep canonical Questmaster titles across tabs, headers, navigation, and hover instead of falling back to repeated IDs

## 2026-08-16

### Changed

- **Transcription Debug loading** -- The newest 15 records load first with older archive pages on demand, and replay transcription selection covers built-in, configured, and source-record models
- **Recurring timer history** -- Contiguous compatible firings of the same unchanged timer compact into one counted expandable row while every real timestamped firing, stable search or deep-link identity, audit detail, and work-trigger boundary remains intact

### Fixed

- **Leader quest tab surfacing** -- Queued or proposed quests reopen their leader tab when work becomes active and stay discoverable through completion or reload, while later manual closes remain respected

## 2026-08-15

### Changed

- **Worker-send activity** -- Collapsed activity labels pure `takode send` invocations as `Sent a message`, while mixed or ambiguous shell commands retain truthful command labels and full expanded detail

## 2026-08-13

### Added

- **Personal to-dos** -- A separate server-authoritative Markdown Todo/Doing/Done outline supports categories, search, active ordering, marker-first completion, date-grouped history, recoverable drafts, reversible archive, and stale-safe UI Undo, with compact CLI access, proposals and grants, and fail-closed mutation authority

### Changed

- **Mobile participant labels** -- Quest banners show full Leader and Worker labels with role icons through 320px while the selected-session TopBar keeps its compact `#N` identity
- **Work recovery authorization** -- Recoverable interruptions resume the remaining approved Work envelope instead of serial micro-handoffs, while genuine approval and safety gates remain unchanged
- **Codex reasoning selection** -- Ordinary controls show one selected effort and confirmed runtime mismatches add a compact warning, while Codex-reported effective effort remains authoritative for validation and targeted CLI or debug diagnostics
- **Leader decision communication** -- Leader decisions and material status updates lead with the problem, impact, recommendation, choices, and requested answer while incidental technical evidence stays in durable records and approval safeguards remain intact
- **Quest Journey colors** -- Active Alignment, Work, User Checkpoint, and Memory phases use distinct cyan, green, amber, and violet styling with accessible light and dark contrast
- **Codex worker multi-agent mode** -- Normal leader-created Codex workers use native multi-agent V2 by default and existing idle workers migrate through a guarded fresh-thread handoff, while leaders, reviewers, manual sessions, and archived sessions remain on V1

### Fixed

- **Copilot request retries** -- Eligible transient stream failures retry quietly with compact progress; successful recovery hides transient errors, while side-effect uncertainty or exhausted retries still fail closed
- **Recovery ownership** -- Leader escalations, repeated board stalls, and retry indicators stay tied to the exact owning turn or occurrence so later activity cannot consume, suppress, or resurrect stale recovery state
- **Collapsed leader responses** -- Substantive replies remain visible when later outcome reminders add empty or low-value rows, without changing Ready collapse, routing, needs-input priority, or expanded audit history
- **Attached thread rendering** -- Historical attached rows no longer flash phantom duplicates after remounts or thread navigation, while authoritative content and position stay unchanged
- **Empty assistant rows** -- Fully post-processed assistant messages no longer leave blank avatar or menu shells, while status footers, raw history, side effects, and visible child UI remain intact
- **Mobile composer focus** -- Narrow-touch session and thread navigation no longer auto-focuses the composer; drafts, explicit taps, and desktop focus behavior remain intact

## 2026-08-12

### Changed

- **Reasoning detail groups** -- Consecutive compatible Codex reasoning summaries collapse into one newest-summary preview with a count, while expansion preserves every original detail and chronology or ownership boundaries

### Fixed

- **Paused-input banner contrast** -- Automatic-input pause and recovery states use theme-aware text, icon, chip, border, and card colors for readable light and dark themes without changing recovery behavior
- **Leader thread outcomes** -- Fresh same-thread leader text, tool activity, or reasoning clears stale Ready/Waiting footers while preserving historical markers, unread state, and unrelated threads
- **Archived session reconciliation** -- Server-confirmed archives disappear promptly and cannot be resurrected by older in-flight active-session snapshots, while later backend state and lazy archived loading remain authoritative

## 2026-08-10

### Added

- **Role-aware session defaults** -- Settings keep separate server-backed defaults for future Leader and Worker sessions while preserving existing per-group creation choices and explicit overrides
- **Session reconnect controls** -- Codex recovery shows up to five process attempts, offers a fresh-cycle Reconnect action, and lets leaders reconnect eligible owned workers without sending task text
- **Codex reasoning details** -- Each official reasoning-summary part is stored and rendered as its own chronological expandable detail, converging live and completed updates without merged or duplicate rows while redundant root-level thinking rows stay hidden

### Changed

- **Composer model controls** -- Codex model selection uses a compact model-and-effort chip with nested Model, Effort, and capability-gated Speed controls, plus Reset to fresh role defaults
- **Codex Goal browser surface** -- The Session Info Goal editor and browser `/goal` shortcut are removed while backend and CLI Goal state remain available for automatic continuation
- **Alignment and herd context** -- Routine Alignment completion uses normal turn completion instead of an approval prompt, and structured preload or recovery bodies are bounded before leader-model injection while audit history remains available
- **Long tool activity summaries** -- Large collapsed Bash or MCP groups switch to a stable `N tool calls` label while expanded audit detail and smaller descriptive summaries remain intact

### Fixed

- **Passive disconnected sessions** -- Post-restart viewing shows a quiet recoverable-disconnected state instead of a false startup spinner without waking the backend
- **Provider recovery** -- Temporary Copilot authentication or network failures use bounded refresh and replay only provably side-effect-free turns, while unsupported models remain terminal and Claude interruption diagnostics stay out of conversation history
- **Leader activity ownership** -- An idle leader no longer inherits a running worker's route or timer in its activity chip
- **Codex stale delivery replay** -- Already-processed user and mixed herd or system payloads cannot be automatically re-delivered as fresh turns when provider or local model activity proves ownership, while genuinely undelivered user-only work still recovers
- **Cached leader thread refresh** -- Reopening a cached leader tab revalidates its authoritative window so routed worker events and leader responses cannot remain hidden in stale almost-empty history

## 2026-08-08

### Added

- **Direct worker errands** -- Leaders can route one-turn, context-rich, read-only follow-ups directly to an existing worker, while broader or stateful work fails closed to a normal quest

### Changed

- **Browsed-window reconnects** -- Capable browsers reconnect with only the bounded server-authored conversation window currently being viewed instead of passively catching up entire session histories

### Fixed

- **Leader viewport restoration** -- Saved message anchors and routed quest-thread positions survive cold hydration and tab changes, including off-window targets
- **Work Board reminder freshness** -- Delayed dispatchable reminders are tied to the live board-row revision and suppressed when the underlying wait has already changed or cleared

## 2026-08-07

### Changed

- **Selected conversation loading** -- Cold leader startup prioritizes the selected authoritative window before tree, replay, and snapshot work so mobile content appears sooner without sacrificing paging or tool-result closure

## 2026-08-06

### Changed

- **Message timestamp menus** -- Exact message times are available from the existing message menu while rail dots and stars retain their normal navigation and starring behavior
- **Herd event activity** -- Routine non-decision and board-stalled events collapse into compact worker activity while meaningful decisions and complete audit detail remain visible
- **Leader turn summaries** -- Ready leader turns auto-collapse immediately while preserving status-bearing final prose, hiding model-only reminder acknowledgements, and retaining manual expansion

### Fixed

- **Restart continuation context** -- Ordinary restart continuation stays a concise `Continue.` instead of reinjecting the Memory catalog, while new sessions and real compaction or recycle recovery still preload it
- **Completed quest queue banners** -- Completed Journey rows no longer retain stale queued-worker or free-worker wait status, while genuine active and needs-input waits remain visible

## 2026-08-05

### Added

- **Alternate voice reruns** -- A completed voice result can be rerun in append or voice-edit mode using the active in-memory audio without recording again

### Changed

- **Worker reclamation safety** -- Leader guidance treats clean behind-only worktrees as safely replaceable while preserving dirty or genuinely ahead workers and requiring fresh target-ref checks

### Fixed

- **Journey participant projection** -- Active and completed rows for the same quest no longer leave stale worker or reviewer state, and unsynced tracked work remains in Work until its evidence is settled

## 2026-08-04

### Added

- **Audited quest recovery** -- Owning leaders have a reason-required, server-authenticated fallback for exceptional stuck quest completion while normal worker completion remains the preferred path
- **External dependency wakeups** -- Leaders receive targeted board reminders when external session or quest blockers resolve, with cleared dependencies removed from the waiting row

### Changed

- **Leader and worker handoffs** -- Post-Alignment Work dispatches carry only leader-owned deltas, implementation follow-ups prefer the context-rich worker or accepted evidence, and workers report at meaningful milestones
- **Self-contained quest context** -- Refined quest records carry concise standalone background and true follow-up differences instead of depending on linked history for essential context

### Fixed

- **Leader quest tab titles** -- Quest tabs preserve their real Questmaster titles instead of degrading into repeated quest IDs
- **Memory completion Git refresh** -- Final Memory refreshes worker Git state through the server-owned path so completion sees current sync state without weakening identity checks
- **Needs-input decision panels** -- The owning thread again shows the real question, choices, custom reply field, supported voice input, and authoritative loading or retry state

## 2026-08-03

### Added

- **Codex leader compaction mode** -- Leaders can opt into Codex built-in compaction while Takode recycling remains the default and delegation stays available in either mode
- **Sessionless Takode inspection** -- Ordinary Codex contexts can read session and history state without a session identity while invalid authentication, mutations, and unrelated protected operations remain rejected
- **Compact tool activity** -- A Settings option condenses consecutive passive tool calls into categorized expandable summaries while keeping notification and approval interactions visible

### Changed

- **Quest Journey v2** -- New work uses Alignment, Work, and final Memory with User Checkpoint as a Work pause, while legacy Journey history stays readable and completion requires clean synchronized evidence
- **Checkpoint shortcut prompts** -- Notification shortcuts must be explained in the visible decision packet before they are offered, preserving exact-approval safety

### Fixed

- **Completed tool-result closure** -- Visible completed tools receive their latest matching result preview before optional support trimming so historical commands do not reappear as live during later turns

## 2026-08-02

### Added

- **Relay supervision tooling** -- An opt-in monitor-free direct-SSH supervisor package provides transactional ownership, bounded private events, trusted retries, and stale-proof readiness evidence while activation remains separately controlled

### Changed

- **Browser title attention count** -- The tab-title number represents only active unresolved and unmuted needs-input prompts across non-archived sessions, independent of other in-app attention indicators

## 2026-08-01

### Added

- **Quest reviewer identity** -- Leader quest banners show the authoritative Reviewer beside the Worker and keep that identity current through lifecycle refreshes

### Changed

- **Automatic recovery guidance** -- Recovery banners explain the sanitized cause, original pause time, required direct action, and eventual held-input outcome consistently across browsers

### Fixed

- **Historical Journey routes** -- Legitimate completed Explore-to-Implement history remains valid across later board operations while malformed phase data fails closed before provenance can be rewritten
- **Large conversation restoration** -- Mobile and desktop sessions restore through compact authoritative projections and bounded visible windows instead of showing a false-empty Main view

## 2026-07-31

### Added

- **Held-input recovery receipts** -- Automatic-pause recovery keeps durable, sanitized, exact-once outcome records across retry, restart, and ownership handoff, with bounded searchable history and no payload disclosure

### Changed

- **Edit-and-approve checkpoints** -- One fresh reply may make one exact substitution and approve the resulting packet only when every unchanged term and consequence remains unambiguous; all broader edits require a revised packet

## 2026-07-30

### Changed

- **Inbound handoff markers** -- Destination quest feeds hide redundant inbound transition rows while source threads retain the outbound breadcrumb and All Threads keeps the complete audit
- **Raw protocol recording** -- Automatic Claude, Codex, and browser payload capture is off by default while explicit environment opt-in, manual per-session capture, and existing-file inspection remain available
- **Model migration notices** -- Legacy model-identity warnings can be acknowledged across browsers and restarts without erasing audit history, and stale acknowledgements cannot hide a newer event

## 2026-07-29

### Changed

- **Replay comparison layout** -- Transcription Replay & compare starts collapsed while Raw Transcript stays visible and comparison details remain accessible on demand

### Fixed

- **Managed model identity** -- Codex routing fails closed when the selected model cannot be proven, preventing silent drift or fallback while retaining one-time legacy migration provenance

## 2026-07-28

### Added

- **GPT Transcribe voice model** -- New voice-transcription settings default to `gpt-transcribe` with bounded vocabulary and expected-language hints while preserving older and custom model compatibility
- **Transcription replay comparisons** -- Transcription Detail can re-run stored audio or raw transcripts against selected models, save comparison variants, and rediscover a privacy-bounded recording archive after restart
- **Transcription record previews** -- Transcription Debug rows show bounded single-line enhanced-first or raw-fallback excerpts, while unsafe and non-ready records remain preview-free
- **Replay difference highlighting** -- Re-transcribe and re-enhance comparisons highlight stage-correct text changes with readable bounded fallbacks for long inputs

### Changed

- **Composer and Questmaster density** -- The composer condenses model controls into one chip and removes branch/diff metadata, while the compact quest table drops its User review checks column
- **Expected language picker** -- Selected language hints remain visible while the searchable picker stays collapsed until requested

### Fixed

- **Session unread consistency** -- Compact lists, live updates, and selection hydration share one server-authored notification projection so read or closed-thread alerts cannot inflate counts while legitimate unread stays visible
- **Copilot authentication exhaustion** -- Codex sessions pause automatic inputs after a strictly recognized terminal API-key refresh failure while preserving manual recovery and exact-once backlog drain

## 2026-07-27

### Changed

- **Delegate task results** -- Delegate traces group Bash commands with their results, lead with the child summary, and separate task, timing, and inspection metadata from result content

### Fixed

- **Delegate task context** -- Native-fork delegates resume the expected inherited Codex context, fail closed instead of silently starting fresh, and keep pending handoff state accurate
- **Backend startup labels** -- Session creation shows launch progress for Codex, Claude Code, or Claude SDK according to the selected backend
- **Leader route splits** -- Thread routing recognizes split markers even when blank spacer lines surround them

## 2026-07-26

### Changed

- **Delegate task contract** -- The command-only delegation tool is now the general `delegate_task(task)` workflow while retaining hidden child evidence, lifecycle safeguards, and compact parent results

### Fixed

- **Codex startup recovery** -- Queued work waits for initializing or resuming adapters to become ready instead of relaunching them prematurely, and internal initialization turn-end rows stay out of leader activity

## 2026-07-25

### Added

- **Quest commit diffs** -- Leader quest tabs can open quest-recorded code commits with selected-first loading, clear zero-code states, and protection from stale background failures

### Changed

- **Message dates** -- Message timestamps stay time-only today and add compact yesterday, current-year, or prior-year date context for older history
- **Quest Journey details** -- Long phase histories are grouped and windowed so current runs stay readable while older notes remain accessible

### Fixed

- **Delegate child lifecycle** -- Completed hidden delegates leave active session lists without losing UUID-backed transcript inspection

## 2026-07-24

### Changed

- **Post-Explore routing** -- Leaders can revise a completed Explore directly to a clear low-risk Implement step while required User Checkpoints and later safeguards remain protected
- **Light theme contrast** -- Chat, quest links, attention rows, and related light-theme surfaces have clearer text and state contrast

## 2026-07-23

### Added

- **Delegated work** -- Leaders can fork bounded work into a hidden Codex child, keep raw evidence in the child transcript, and receive a compact inspectable parent result

### Changed

- **Bash result visibility** -- Codex Bash cards prefer fuller matching output, mark embedded newlines in collapsed previews, and bound retained raw output
- **Injected event details** -- Injected events show payload size metadata, and memory-catalog snapshots can be copied from their feed rows

### Fixed

- **Thread routing boundaries** -- Mid-message route splits, deep-link scroll targets, and stale ready-status chips resolve to the intended thread without repeated navigation
- **Codex tool readiness** -- Startup and delegated-child prompts wait for refreshed MCP tools and an actual callable handoff tool before proceeding

## 2026-07-22

### Added

- **Memory catalog startup context** -- Leader startup and recovery receive a visible catalog snapshot so relevant durable memory can be inspected before work continues

### Changed

- **Leader tab selection** -- Relevant quest tabs can surface in the background without automatically replacing the leader's selected thread

### Fixed

- **Thread-aware message links** -- Session and message links select the intended thread before jumping to their target
- **Codex shell environment** -- Session-scoped Codex shell tools preserve the configured home directory and its isolated session state

## 2026-07-21

### Added

- **Journey revisions** -- `takode board revise` can replace an active Journey suffix while preserving completed phase history and validating required safeguards

### Changed

- **Board proposals** -- `takode board propose --summary` creates and presents one expanded approval packet with Journey and dependency context

### Fixed

- **Thread continuation links** -- Continuation markers keep their session and quest links when rendered in collapsed feed history

## 2026-07-20

### Added

- **Questmaster local backups** -- Quest and Journey text gains retained local snapshots and mutation journals, with separately deduplicated image blobs and manual restore guidance

### Fixed

- **Needs-input retries** -- Notification retries anchor to visible prompts, deduplicate only exact active retries, and report recovered notification state more accurately
- **Quest hover previews** -- Quest links validate cached preview metadata before rendering so stale summaries do not appear under the wrong quest

## 2026-07-17

### Changed

- **Leader ready outcomes** -- Leader workflows verify promised durable actions before marking a thread Ready

### Fixed

- **All Threads status noise** -- Internal thread-status chips stay out of the combined All Threads feed

## 2026-07-15

### Changed

- **Quest reference autocomplete** -- Composer quest references use the full authoritative candidate set instead of only the currently loaded quest page

### Fixed

- **Message navigator jumps** -- User-message navigation loads off-window targets before scrolling to them
- **Internal status rows** -- Codex retry turn-end events and Thread Ready bookkeeping stay out of the visible conversation feed

## 2026-07-14

### Added

- **Leader skill preloading** -- Leader sessions preload required orchestration skills during startup and recovery so recycled or resumed leaders regain Journey guidance more reliably

### Changed

- **Needs-input suggestions** -- Needs-input prompts can carry more short suggested answers, with guidance updated to keep choices useful without an arbitrary cap
- **Checkpoint approval guidance** -- Leader and checkpoint instructions distinguish actual user decisions from corrections more explicitly before continuing work
- **Leader work summaries** -- Session summaries show waiting counts, and newly started Journeys receive clearer attention treatment

### Fixed

- **Leader preload recovery reminders** -- Recovery reminders avoid false compaction signals during resume replay and point leaders back to preload state more accurately
- **Quest Quiz directives** -- Inline quiz directives render after their quest details arrive instead of remaining unresolved in fetched history

## 2026-07-13

### Changed

- **Quest Journey routing** -- Leaders can use lighter direct dispatch for low-risk tasks, and Outcome Review is optional when the approved Journey does not need a separate acceptance pass
- **Codex launch defaults** -- Codex catalog handling disables unsupported Responses Lite options for MAI LiteLLM catalogs and gives non-leader sessions a safer auto-compact default

### Fixed

- **Quest link previews** -- Quest links show hover previews more reliably
- **Codex model switching** -- Model changes, relaunches, leader context preservation, failed compaction recovery, and recycle watermarks recover more reliably without duplicate migration loops
- **Archived session recovery** -- Archived-session relaunch and partial archive-group failures reconcile UI and server state more consistently

## 2026-07-11

### Changed

- **Codex model catalog** -- Model pickers include refreshed Codex options and runtime-setting updates, with future reasoning parameters preserved for compatible models

## 2026-07-09

### Changed

- **Archived session browsing** -- Archived sessions load in pages and open in read-only views so large archives are lighter and safer to browse

### Fixed

- **Configure Session context capacity** -- Configure Session and session info surfaces show context capacity more accurately for Codex sessions

## 2026-07-08

### Added

- **Notification row actions** -- Notification rows expose per-session actions from notification chip surfaces
- **Questmaster preview loading** -- Quest lists, hover cards, and detail panels can load compact previews before hydrating full quest records

### Fixed

- **Leader tool routing** -- Unthreaded or mixed leader tool/result rows route to the most recent relevant thread more consistently
- **Mixed tool result previews** -- Assistant messages can render mixed tool-result previews without losing surrounding context
- **Quest detail caching** -- Partial quest detail loads preserve summaries and avoid stale detail-cache state

## 2026-07-07

### Added

- **Session directory opening** -- Session info surfaces can open session directories in the local file browser

### Fixed

- **Archived worktree cleanup** -- Archived worktree cleanup retries and retry rows reconcile branch deletion failures more reliably

## 2026-07-06

### Fixed

- **Archive reconciliation** -- Sidebar archive mutations and reviewer archive markers roll back or reconcile more safely when archive operations fail

## 2026-07-02

### Changed

- **Quest Quiz guidance** -- Completion guidance makes quiz questions more useful and better grounded in agent-discovered outcomes

### Fixed

- **Thread route splitting** -- Post-quiz routes, split thread routes, and ready-thread unread views avoid cumulative append and stale read-state issues

## 2026-07-01

### Changed

- **Pushover prompts** -- Pushover input prompts use a clearer title

### Fixed

- **Reviewer sidebar chips** -- Reviewer labels fit and render consistently in sidebar chips
- **Diff syntax highlighting** -- Unified diff panels highlight syntax more reliably
- **Leader thread tabs** -- Completed leader thread tabs, active Work Board tab ordering, and ready-thread unread markers persist more predictably

## Earlier history

Changes from April 10 to June 30, 2026 are in the [April to June 2026 changelog](docs/changelog/2026-04-to-06.md).
