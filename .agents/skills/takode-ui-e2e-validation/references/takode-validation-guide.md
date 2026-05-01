# Takode Validation Guide

Use this reference after loading the `takode-ui-e2e-validation` skill when detailed command patterns or workflow heuristics are needed.

## Lease Pattern

Acquire leases before touching shared browser or server resources. Choose the lease scope by the resource you will actually use:

```bash
# Full browser validation on an isolated Takode app normally needs both:
takode lease acquire dev-server:companion --purpose "Validate q-N UI" --ttl 30m --wait
takode lease acquire agent-browser --purpose "Validate q-N UI" --ttl 20m --wait

# Server-only validation or setup:
takode lease acquire dev-server:companion --purpose "Validate q-N server" --ttl 30m --wait

# Browser-only inspection of an already-authorized server:
takode lease acquire agent-browser --purpose "Inspect q-N UI" --ttl 20m --wait
```

If the command queues behind another holder, it prints the owner and queue details, then the server sends a Resource Lease message to your session when you are promoted. Do not poll in a loop; use `takode lease status <resource>` only for an intentional manual refresh.

Renew long sessions before leases expire:

```bash
takode lease renew dev-server:companion
takode lease renew agent-browser
```

Release promptly:

```bash
takode lease release agent-browser
takode lease release dev-server:companion
```

If a lease is held by another session, queue, wait for the Resource Lease promotion message, or choose a documented non-conflicting path. Do not start a competing browser or dev server.

## Server And Port Safety

Takode agents depend on the live/session server on `:3456`. Never stop, kill, replace, restart, or bind over it during validation.

Prefer isolated validation ports:

```bash
# Terminal 1, from web/
PORT=3467 NODE_ENV=development bun server/index.ts

# Terminal 2, from web/
PORT=3467 bun run dev:vite -- --host 0.0.0.0 --port 5178
```

Then browse:

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
agent-browser set viewport 430 932
```

Use existing project scripts only when their hardcoded ports are appropriate and you hold the lease. `scripts/dev-start.sh` uses backend `3457` and frontend `5174`; it may stop processes on those ports when asked to start or stop, so do not use it for unknown or shared port occupants.

## Agent Browser Flow

Run `agent-browser skills get core --full`, `agent-browser --help`, or a subcommand help page if exact syntax is uncertain; the installed wrapper also optimizes screenshot output by default.

Typical flow:

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
agent-browser screenshot /tmp/takode-q-N/desktop-initial.png
agent-browser open http://127.0.0.1:5178/#/playground
agent-browser set viewport 430 932
agent-browser screenshot /tmp/takode-q-N/mobile-playground.png
```

Prefer semantic interactions and visible UI checks. Use DOM probes only when they answer an objective question that screenshots or visible interaction cannot, such as bounding boxes, aria state, or exact row counts.

## Theme And Viewports

Dark theme is Takode's primary validation theme. If the app persists a different theme, switch to dark before taking acceptance screenshots.

Use at least:

- Desktop: around `1440x1000` for dense workspaces.
- Mobile: at least `430x932`, matching a normal iPhone Pro/Max-sized screen.

Add narrower or wider viewports only when the changed surface depends on them.

## Screenshot And Artifact Handling

Store transient evidence outside tracked source unless the quest explicitly asks for committed artifacts:

```bash
mkdir -p /tmp/takode-q-N
```

Use descriptive names:

- `desktop-quest-detail-open.png`
- `mobile-permission-banner-denied.png`
- `playground-tool-block-streaming.png`

Takode's `agent-browser screenshot` wrapper preserves the original screenshot and returns an optimized `.takode-agent.` sibling by default. Cite the optimized path in notes unless pixel-level debugging requires the original. For screenshots produced by other local tools, run:

```bash
quest optimize-image /tmp/takode-q-N/example.png
```

Do not recompress paths that already contain `.takode-agent.`. Clean up large temporary directories when they are no longer useful.

## Playground Coverage

Update and validate Playground when a changed state belongs to the message/chat flow:

- Message rows and grouping.
- Tool blocks and tool summaries.
- Permission banners and approval states.
- Composer states.
- Streaming, subagent, terminal, or thread-related message states.

The route is `#/playground`. Prefer validating the specific section that represents the changed component state.

## Surface Heuristics

Questmaster:

- Check both list/card state and detail-panel state when the change affects quest metadata, review state, verification items, or feedback.
- Be careful with mutable quest actions. Prefer disposable test quests or read-only visual checks unless the quest explicitly authorizes state changes.

Work Board and thread tabs:

- Verify status movement, attention/read indicators, thread selection, and persistence after navigation.
- Use screenshots before and after tab/session switches when the bug involves stale state.

Chat/message feed:

- Verify streaming, completed, compacted, and tool-result states as applicable.
- Check that messages do not overlap fixed composer or sidebar regions on mobile.
- If a component state cannot be naturally produced, represent it in Playground and validate there.

Permission/tool blocks:

- Exercise pending, approved, denied, cancelled, collapsed, and expanded states when touched by the change.
- Keep permission actions local and reversible. Do not approve externally consequential tools just to get a screenshot.

## Phase Note Template

Use this structure for Implement or Execute notes when browser evidence matters:

```markdown
Validation method: agent-browser workflow on isolated ports.
Resources: held dev-server:companion and agent-browser leases; did not touch :3456.
URL/viewports: http://127.0.0.1:5178 at 1440x1000 and 430x932, dark theme.
Coverage: <workflow steps and expected result>.
Evidence: <optimized screenshot paths or artifact inventory>.
Skipped: <checks not run and why>.
Risk: <remaining uncertainty>.
```

## Extending This Skill

Add new generalized lessons when a quest reveals repeatable Takode validation friction. Keep `SKILL.md` lean; place detailed workflow notes in this reference or a sibling reference. Add scripts only when they remove a repeated, deterministic source of mistakes.

Create a new quest instead of opportunistically expanding this skill when the change is broad, controversial, or motivated by one major workflow that needs its own design discussion.
